import { randomUUID } from "node:crypto";
import AccountDeletionJob, { initialDeletionTracking } from "../models/AccountDeletionJob.js";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import RefreshToken from "../models/refreshTokenModel.js";
import { revokeAppleAuthorization, appleTokenStorageConfigured } from "./appleTokenService.js";
import { revokeConsent } from "./aiConsent.js";

import deletionNotification from "./deletionNotification.js";
import Chat from "../models/Chat.js";
import { cleanupAccountData } from "./accountCleanupService.js";
import { deletionDueAt, deletionCleanupBlockers, RETENTION_DAYS, RETENTION_POLICY_VERSION } from "./deletionRetentionPolicy.js";
export const RETENTION_BLOCKER = "RETENTION_PERIOD_ACTIVE";

export async function requestAccountDeletion(user) {
  // Validate prerequisites while the caller can still reauthenticate with Apple.
  // Do not queue an impossible request and lock them out of repairing it.
  if (user.appleId) {
    if (!user.appleTokenCiphertext) throw Object.assign(new Error("Please sign in with Apple again before deleting your account."), { code: "APPLE_REAUTH_REQUIRED", status: 409 });
    if (!appleTokenStorageConfigured()) throw Object.assign(new Error("Apple deletion configuration is required. Contact support@humaeli.com."), { code: "APPLE_REVOCATION_SETUP_REQUIRED", status: 503 });
  }
  const job = await AccountDeletionJob.findOneAndUpdate({ _id: user._id }, {
    $setOnInsert: { status: "pending", nextAttemptAt: new Date(), retentionUntil: deletionDueAt(new Date()), policyVersion: RETENTION_POLICY_VERSION },
  }, { upsert: true, returnDocument: "after" });
  // The durable request itself is also an auth barrier. A crash between these
  // writes cannot restore access; middleware checks the job as well as isActive.
  await User.updateOne({ _id: user._id }, { $set: { isActive: false, isOnline: false, fcmToken: null } });
  await Session.updateMany({ userId: user._id }, { $set: { isActive: false } });
  await RefreshToken.deleteMany({ userId: user._id });
  for (const role of ["user", "counsellor", "counselor"]) global.io?.in(`${role}_${user._id}`).disconnectSockets(true);
  return job;
}

export const accountDeletionPending = async userId => Boolean(await AccountDeletionJob.exists({ _id: userId }));

// Access is revoked immediately; records wait 90 days from the request.
// Provider/backup verification and legal holds prevent a false completion.
export async function processAccountDeletionJob(now = new Date()) {
  const leaseOwner = randomUUID();
  const job = await AccountDeletionJob.findOneAndUpdate({
    status: { $in: ["pending", "processing", "retry", "waiting_retention", "blocked_retention", "blocked_cleanup"] },
    nextAttemptAt: { $lte: now },
    $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
  }, { $set: { status: "processing", leaseOwner, leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { returnDocument: "after", sort: { nextAttemptAt: 1 } }).select("+completionEmail");
  if (!job) return null;
  const fence = { _id: job._id, leaseOwner };
  try {
    // Persist explicit unknowns for legacy requests. Absence of evidence is
    // never interpreted as no legal hold, no backup or provider erasure.
    await AccountDeletionJob.updateOne({ ...fence, cleanupTracking: { $exists: false } }, { $set: { cleanupTracking: initialDeletionTracking() } });
    const user = await User.findById(job._id).select("+appleTokenCiphertext");
    if (!user) {
      if (job.cleanupContext && !deletionCleanupBlockers(job.cleanupTracking).length && now >= (job.retentionUntil || deletionDueAt(job.createdAt || now))) {
        await deletionNotification.send(job.completionEmail);
        await AccountDeletionJob.updateOne(fence, { $set: { status: "completed", completedAt: now, completionNoticeSentAt: now, blockers: [], "cleanupTracking.retainedRecords": "verified_erased" }, $unset: { leaseUntil: 1, leaseOwner: 1, cleanupContext: 1, completionEmail: 1 } });
        return { id: String(job._id), status: "completed" };
      }
      throw Object.assign(new Error("Missing account requires operator reconciliation"), { code: "ACCOUNT_RECONCILIATION_REQUIRED" });
    }
    await User.updateOne({ _id: job._id }, { $set: { isActive: false, isOnline: false, fcmToken: null } });
    await Session.updateMany({ userId: job._id }, { $set: { isActive: false } });
    await RefreshToken.deleteMany({ userId: job._id });
    await AccountDeletionJob.updateOne(fence, { $set: { accessRevokedAt: new Date() } });
    if (!job.appleRevokedAt) {
      await revokeAppleAuthorization(user);
      await AccountDeletionJob.updateOne(fence, { $set: { appleRevokedAt: new Date() } });
    }
    await AccountDeletionJob.updateOne(fence, { $set: { "cleanupTracking.appleAuthorization": user.appleId ? "revoked" : "not_applicable" } });
    await revokeConsent(job._id);
    await AccountDeletionJob.updateOne(fence, { $set: { "cleanupTracking.aiConsent": "revoked" } });
    const retentionUntil = job.retentionUntil || deletionDueAt(job.createdAt || now);
    if (now < retentionUntil) {
      await AccountDeletionJob.updateOne(fence, {
        $set: { status: "waiting_retention", retentionUntil, policyVersion: RETENTION_POLICY_VERSION, nextAttemptAt: retentionUntil, blockers: [RETENTION_BLOCKER] },
        $unset: { leaseUntil: 1, leaseOwner: 1, lastErrorCode: 1 },
      });
      return { id: String(job._id), status: "waiting_retention", retentionUntil, retentionDays: RETENTION_DAYS };
    }
    const blockers = deletionCleanupBlockers(job.cleanupTracking);
    if (blockers.length) {
      await AccountDeletionJob.updateOne(fence, {
        $set: { status: "blocked_cleanup", retentionUntil, blockers, nextAttemptAt: new Date(now.getTime() + 3600000) },
        $unset: { leaseUntil: 1, leaseOwner: 1 },
      });
      return { id: String(job._id), status: "blocked_cleanup" };
    }
    // Persist the relationship inventory before any purge so retries cannot
    // orphan messages/assets if an earlier attempt already removed a chat.
    let cleanupContext = job.cleanupContext;
    if (!cleanupContext) {
      const chats = await Chat.find({ $or: [{ userId: job._id }, { counselorId: job._id }] }).select("_id chatId paidSessionId");
      cleanupContext = { chats: chats.map(c => ({ _id: c._id, chatId: c.chatId, paidSessionId: c.paidSessionId })) };
      await AccountDeletionJob.updateOne(fence, { $set: { cleanupContext } });
    }
    await AccountDeletionJob.updateOne(fence, { $set: { completionEmail: user.email } });
    const result = await cleanupAccountData({ userId: job._id, email: user.email, cleanupContext, eraseFinancial: true });
    if (!result.acknowledged) throw new Error("Cleanup not acknowledged");
    await User.deleteOne({ _id: job._id });
    await deletionNotification.send(user.email);
    await AccountDeletionJob.updateOne(fence, {
      $set: { status: "completed", completedAt: now, completionNoticeSentAt: now, blockers: [], "cleanupTracking.retainedRecords": "verified_erased" },
      $unset: { leaseUntil: 1, leaseOwner: 1, cleanupContext: 1, completionEmail: 1, lastErrorCode: 1 },
    });
    return { id: String(job._id), status: "completed" };
  } catch (error) {
    // Persist only a controlled code, never provider bodies, tokens or PII.
    const code = /^APPLE_[A-Z_]+$/.test(error.code || "") ? error.code : "CLEANUP_RETRY_REQUIRED";
    await AccountDeletionJob.updateOne(fence, {
      $set: { status: "retry", lastErrorCode: code, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12))) },
      $unset: { leaseUntil: 1, leaseOwner: 1 },
    });
    return { id: String(job._id), status: "retry" };
  }
}

export function startAccountDeletionWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { for (let n = 0; n < 10; n += 1) { if (!await processAccountDeletionJob()) break; } }
    catch { console.error("Account deletion worker unavailable; durable requests will be retried."); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

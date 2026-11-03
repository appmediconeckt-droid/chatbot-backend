import { randomUUID } from "node:crypto";
import AccountDeletionJob, { initialDeletionTracking } from "../models/AccountDeletionJob.js";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import RefreshToken from "../models/refreshTokenModel.js";
import { revokeAppleAuthorization, appleTokenStorageConfigured } from "./appleTokenService.js";
import { revokeConsent } from "./aiConsent.js";

export const RETENTION_BLOCKER = "RETENTION_POLICY_APPROVAL_REQUIRED";

export async function requestAccountDeletion(user) {
  // Validate prerequisites while the caller can still reauthenticate with Apple.
  // Do not queue an impossible request and lock them out of repairing it.
  if (user.appleId) {
    if (!user.appleTokenCiphertext) throw Object.assign(new Error("Please sign in with Apple again before deleting your account."), { code: "APPLE_REAUTH_REQUIRED", status: 409 });
    if (!appleTokenStorageConfigured()) throw Object.assign(new Error("Apple deletion configuration is required. Contact support@humaeli.com."), { code: "APPLE_REVOCATION_SETUP_REQUIRED", status: 503 });
  }
  const job = await AccountDeletionJob.findOneAndUpdate({ _id: user._id }, {
    $setOnInsert: { status: "pending", nextAttemptAt: new Date() },
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

// All effects before the retention gate are safe to repeat. No service,
// clinical, financial, attachment or identity record is erased without an
// approved retention policy. There is deliberately no env-var bypass.
export async function processAccountDeletionJob(now = new Date()) {
  const leaseOwner = randomUUID();
  const job = await AccountDeletionJob.findOneAndUpdate({
    status: { $in: ["pending", "processing", "retry"] },
    nextAttemptAt: { $lte: now },
    $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
  }, { $set: { status: "processing", leaseOwner, leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { returnDocument: "after", sort: { nextAttemptAt: 1 } });
  if (!job) return null;
  const fence = { _id: job._id, leaseOwner };
  try {
    // Persist explicit unknowns for legacy requests. Absence of evidence is
    // never interpreted as no legal hold, no backup or provider erasure.
    await AccountDeletionJob.updateOne({ ...fence, cleanupTracking: { $exists: false } }, { $set: { cleanupTracking: initialDeletionTracking() } });
    const user = await User.findById(job._id).select("+appleTokenCiphertext");
    if (!user) throw Object.assign(new Error("Missing account requires operator reconciliation"), { code: "ACCOUNT_RECONCILIATION_REQUIRED" });
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
    await AccountDeletionJob.updateOne(fence, {
      $set: { status: "blocked_retention", blockers: [RETENTION_BLOCKER, "LEGAL_HOLD_REVIEW_REQUIRED", "BACKUP_CLEANUP_VERIFICATION_REQUIRED", "EXTERNAL_PROVIDER_CLEANUP_VERIFICATION_REQUIRED"] },
      $unset: { leaseUntil: 1, leaseOwner: 1, lastErrorCode: 1 },
    });
    return { id: String(job._id), status: "blocked_retention" };
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

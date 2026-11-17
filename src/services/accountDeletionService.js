import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import AccountDeletionJob, { initialDeletionTracking } from "../models/AccountDeletionJob.js";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import RefreshToken from "../models/refreshTokenModel.js";
import { revokeAppleAuthorization, appleTokenStorageConfigured } from "./appleTokenService.js";
import { revokeConsent } from "./aiConsent.js";

import deletionNotification from "./deletionNotification.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Prescription from "../models/Prescription.js";
import { prescriptionAccountOwnershipFilter } from "./accountDeletionOwnership.js";
import { cleanupAccountData } from "./accountCleanupService.js";
import { deletionDueAt, deletionCleanupBlockers, RETENTION_DAYS, RETENTION_POLICY_VERSION } from "./deletionRetentionPolicy.js";

async function eraseLocalWithReceipt(job, fence, email, cleanupContext) {
  // Writing the leased job inside the same transaction fences the entire local
  // purge. A concurrent claim/approval change conflicts and rolls it back.
  await mongoose.connection.transaction(async mongoSession => {
    const current = await AccountDeletionJob.findOne({ ...fence, status: "processing" }).session(mongoSession);
    if (!current || current.cleanupTracking?.legalHolds === "active") throw new Error("Cleanup lease changed or legal hold active");
    const locked = await AccountDeletionJob.updateOne({ ...fence, status: "processing" }, { $set: { localCleanupStartedAt: new Date() } }, { session: mongoSession });
    if (locked.matchedCount !== 1) throw new Error("Cleanup lease lost");
    const receipt = await cleanupAccountData({ userId: job._id, email, cleanupContext, eraseFinancial: true, mongoSession });
    if (!receipt.verified) throw new Error("Cleanup not verified");
    const erased = await User.deleteOne({ _id: job._id }, { session: mongoSession });
    if (erased.acknowledged !== true || await User.exists({ _id: job._id }).session(mongoSession)) throw new Error("Account erasure not verified");
    const saved = await AccountDeletionJob.updateOne(fence, { $set: { localCleanupVerifiedAt: new Date(), localCleanupOperations: receipt.operations } }, { session: mongoSession });
    if (saved.matchedCount !== 1) throw new Error("Cleanup receipt not saved");
  });
}


export async function requestAccountDeletion(user) {
  // Validate prerequisites while the caller can still reauthenticate with Apple.
  // Do not queue an impossible request and lock them out of repairing it.
  if (user.appleId) {
    if (!user.appleTokenCiphertext) throw Object.assign(new Error("Please sign in with Apple again before deleting your account."), { code: "APPLE_REAUTH_REQUIRED", status: 409 });
    if (!appleTokenStorageConfigured()) throw Object.assign(new Error("Apple deletion configuration is required. Contact support@humaeli.com."), { code: "APPLE_REVOCATION_SETUP_REQUIRED", status: 503 });
  }
  const sessions = await Session.find({ userId: user._id }).select("_id");
  const job = await AccountDeletionJob.findOneAndUpdate({ _id: user._id }, {
    $setOnInsert: { status: "pending", nextAttemptAt: new Date(), retentionUntil: deletionDueAt(new Date()), policyVersion: RETENTION_POLICY_VERSION, requestSessionIds: sessions.map(session => session._id) },
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

// Run during the deletion request, with durable retries after interruptions.
// Provider and backup receipts do not delay live database erasure.
export async function processAccountDeletionJob(now = new Date(), accountId = null) {
  const leaseOwner = randomUUID();
  const job = await AccountDeletionJob.findOneAndUpdate({
    status: { $in: ["pending", "processing", "retry", "waiting_retention", "blocked_retention", "blocked_cleanup"] },
    ...(accountId ? { _id: accountId } : {}),
    $and: [
      { $or: [{ nextAttemptAt: { $lte: now } }, { status: { $in: ["waiting_retention", "blocked_retention", "blocked_cleanup", "retry"] }, policyVersion: { $ne: RETENTION_POLICY_VERSION } }] },
      { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] },
    ],
  }, { $set: { status: "processing", policyVersion: RETENTION_POLICY_VERSION, leaseOwner, leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { returnDocument: "after", sort: { nextAttemptAt: 1 } }).select("+completionEmail");
  if (!job) return null;
  const fence = { _id: job._id, leaseOwner };
  try {
    // Persist explicit unknowns for legacy requests. Absence of evidence is
    // never interpreted as no legal hold, no backup or provider erasure.
    await AccountDeletionJob.updateOne({ ...fence, cleanupTracking: { $exists: false } }, { $set: { cleanupTracking: initialDeletionTracking() } });
    const user = await User.findById(job._id).select("+appleTokenCiphertext");
    if (!user && !job.localCleanupVerifiedAt) {
      throw Object.assign(new Error("Missing account requires operator reconciliation"), { code: "ACCOUNT_RECONCILIATION_REQUIRED" });
    }
    if (job.cleanupTracking?.legalHolds === "active" && !job.localCleanupVerifiedAt) {
      await AccountDeletionJob.updateOne(fence, { $set: { status: "blocked_cleanup", blockers: ["LEGAL_HOLD_ACTIVE"], nextAttemptAt: new Date(now.getTime() + 3600000) }, $unset: { leaseUntil: 1, leaseOwner: 1 } });
      return { id: String(job._id), status: "blocked_cleanup" };
    }
    if (!job.localCleanupVerifiedAt) {
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
      // No waiting period or blanket manual approval before live-data erasure.
      await AccountDeletionJob.updateOne(fence, { $set: { retentionUntil: now, policyVersion: RETENTION_POLICY_VERSION } });
      // Persist the relationship inventory before any purge so retries cannot
      // orphan messages/assets if an earlier attempt already removed a chat.
      let cleanupContext = job.cleanupContext;
      if (!cleanupContext?.profileAssets) {
        const chats = cleanupContext?.chats || await Chat.find({ $or: [{ userId: job._id }, { counselorId: job._id }] }).select("_id chatId paidSessionId");
        const chatIds = chats.map(c => c._id);
        const messageIds = [...chatIds, ...chats.map(c => c.chatId).filter(Boolean)];
        const attachmentUrls = await Message.distinct("attachmentUrl", { $or: [{ senderId: job._id }, { chatId: { $in: messageIds } }] });
        const prescriptions = await Prescription.find(prescriptionAccountOwnershipFilter(job._id, chatIds)).select("pdf.url patientSnapshot.photo psychiatristSnapshot.prescriptionSignature psychiatristSnapshot.prescriptionSeal").lean();
        cleanupContext = {
          attachmentUrls: attachmentUrls.filter(Boolean),
          prescriptionAssets: prescriptions,
          chats: chats.map(c => ({ _id: c._id, chatId: c.chatId, paidSessionId: c.paidSessionId })),
          // Preserve known provider pointers for cleanup after the profile is erased.
          profileAssets: { photo: user.profilePhoto, photoPublicId: user.profilePhotoPublicId, signature: user.prescriptionSignature, seal: user.prescriptionSeal, certifications: user.certifications?.map(c => ({ url: c.document?.url || c.documentUrl || c.url, publicId: c.documentPublicId || c.publicId })) },
        };
        await AccountDeletionJob.updateOne(fence, { $set: { cleanupContext } });
      }
      await AccountDeletionJob.updateOne(fence, { $set: { completionEmail: user.email } });
      await eraseLocalWithReceipt(job, fence, user.email, cleanupContext);
    }
    const blockers = deletionCleanupBlockers(job.cleanupTracking);
    if (blockers.length) {
      await AccountDeletionJob.updateOne(fence, {
        $set: { status: "blocked_cleanup", blockers, "cleanupTracking.retainedRecords": "verified_erased", nextAttemptAt: new Date(now.getTime() + 3600000) },
        $unset: { leaseUntil: 1, leaseOwner: 1 },
      });
      return { id: String(job._id), status: "account_deleted", cleanupPending: true };
    }
    await deletionNotification.send(user?.email || job.completionEmail);
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

export function accountDeletionResponse(job) {
  if (job.status === "completed") return { statusCode: 200, body: {
    success: true, status: "completed", requestId: String(job._id), retentionDays: RETENTION_DAYS,
    message: "Your account deletion is complete.",
  } };
  if (job.localCleanupVerifiedAt) return { statusCode: 200, body: {
    success: true, status: "account_deleted", localDataDeleted: true, cleanupPending: true,
    requestId: String(job._id), retentionDays: RETENTION_DAYS,
    message: "Your account and live database records have been deleted. Provider and backup cleanup confirmation is still pending. Contact support@humaeli.com for progress.",
  } };
  return { statusCode: 202, body: {
    success: false, accepted: true, code: "ACCOUNT_DELETION_PENDING", status: job.status,
    requestId: String(job._id), retentionDays: RETENTION_DAYS,
    message: "Account access is disabled and deletion is being retried without a waiting period. A legal hold or processing failure can delay completion. Contact support@humaeli.com for progress.",
  } };
}

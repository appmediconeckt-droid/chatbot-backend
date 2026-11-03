import mongoose from "mongoose";

export const initialDeletionTracking = () => ({
  retainedRecords: "blocked_policy",
  legalHolds: "unreviewed",
  backups: "not_verified",
  cloudinaryCleanup: "blocked_policy",
  streamCleanup: "not_verified",
  appleAuthorization: "pending",
  aiConsent: "pending",
});
const tracking = new mongoose.Schema({
  retainedRecords: { type: String, enum: ["blocked_policy", "retained_approved", "verified_erased"], default: "blocked_policy" },
  legalHolds: { type: String, enum: ["unreviewed", "active", "reviewed"], default: "unreviewed" },
  backups: { type: String, enum: ["not_verified", "pending", "verified"], default: "not_verified" },
  cloudinaryCleanup: { type: String, enum: ["blocked_policy", "pending", "verified", "not_applicable"], default: "blocked_policy" },
  streamCleanup: { type: String, enum: ["not_verified", "pending", "verified", "not_applicable"], default: "not_verified" },
  appleAuthorization: { type: String, enum: ["pending", "revoked", "not_applicable"], default: "pending" },
  aiConsent: { type: String, enum: ["pending", "revoked"], default: "pending" },
  policyApprovalReference: String,
  manualReviewReference: String,
}, { _id: false });

// _id is the account ID: MongoDB's built-in unique index makes requests
// idempotent even before any optional secondary indexes have been built.
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: { type: String, enum: ["pending", "processing", "retry", "blocked_retention", "completed"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  leaseOwner: String,
  appleRevokedAt: Date,
  accessRevokedAt: Date,
  lastErrorCode: String,
  blockers: [String],
  cleanupTracking: { type: tracking, default: initialDeletionTracking },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
export default mongoose.model("AccountDeletionJob", schema);

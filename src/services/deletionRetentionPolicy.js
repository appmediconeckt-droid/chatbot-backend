// Product-owner instruction, 14 November 2026: retain records for 90 days
// after an account deletion request. This is not a determination of legal duties.
export const RETENTION_DAYS = 90;
export const RETENTION_POLICY_VERSION = "owner-90-days-2026-11-14";
export const deletionDueAt = requestedAt => {
  const date = new Date(requestedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Valid deletion request date required");
  return new Date(date.getTime() + RETENTION_DAYS * 86400000);
};
export function deletionCleanupBlockers(tracking = {}) {
  const blockers = [];
  if (tracking.legalHolds !== "reviewed") blockers.push("LEGAL_HOLD_REVIEW_REQUIRED");
  if (tracking.backups !== "verified") blockers.push("BACKUP_CLEANUP_VERIFICATION_REQUIRED");
  if (!["verified", "not_applicable"].includes(tracking.cloudinaryCleanup)) blockers.push("CLOUDINARY_CLEANUP_VERIFICATION_REQUIRED");
  if (!["verified", "not_applicable"].includes(tracking.streamCleanup)) blockers.push("STREAM_CLEANUP_VERIFICATION_REQUIRED");
  if (!tracking.manualReviewReference) blockers.push("CLEANUP_REVIEW_REFERENCE_REQUIRED");
  return blockers;
}

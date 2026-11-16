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
  if (!String(tracking.policyApprovalReference || "").trim()) blockers.push("RETENTION_POLICY_APPROVAL_REQUIRED");
  if (tracking.legalHolds !== "reviewed") blockers.push("LEGAL_HOLD_REVIEW_REQUIRED");
  if (tracking.backups !== "verified") blockers.push("BACKUP_CLEANUP_VERIFICATION_REQUIRED");
  if (!["verified", "not_applicable"].includes(tracking.cloudinaryCleanup)) blockers.push("CLOUDINARY_CLEANUP_VERIFICATION_REQUIRED");
  if (!["verified", "not_applicable"].includes(tracking.streamCleanup)) blockers.push("STREAM_CLEANUP_VERIFICATION_REQUIRED");
  if (!String(tracking.manualReviewReference || "").trim()) blockers.push("CLEANUP_REVIEW_REFERENCE_REQUIRED");
  for (const [status, receipt, code] of [
    ["backups", "backupCleanupReceipt", "BACKUP_CLEANUP_RECEIPT_REQUIRED"],
    ["cloudinaryCleanup", "cloudinaryCleanupReceipt", "CLOUDINARY_CLEANUP_RECEIPT_REQUIRED"],
    ["streamCleanup", "streamCleanupReceipt", "STREAM_CLEANUP_RECEIPT_REQUIRED"],
  ]) {
    if (tracking[status] === "verified" && !String(tracking[receipt] || "").trim()) blockers.push(code);
  }
  return blockers;
}

// Owner instruction, 17 November 2026: start erasure immediately on confirmation.
// Known legal holds and external cleanup receipts remain distinct from local erasure.
export const RETENTION_DAYS = 0;
export const RETENTION_POLICY_VERSION = "owner-immediate-deletion-2026-11-17";
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
  for (const [status, receipt, code] of [
    ["backups", "backupCleanupReceipt", "BACKUP_CLEANUP_RECEIPT_REQUIRED"],
    ["cloudinaryCleanup", "cloudinaryCleanupReceipt", "CLOUDINARY_CLEANUP_RECEIPT_REQUIRED"],
    ["streamCleanup", "streamCleanupReceipt", "STREAM_CLEANUP_RECEIPT_REQUIRED"],
  ]) {
    if (tracking[status] === "verified" && !String(tracking[receipt] || "").trim()) blockers.push(code);
  }
  return blockers;
}

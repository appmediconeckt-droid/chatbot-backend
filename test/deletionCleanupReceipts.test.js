import { expect } from 'chai';
import { deletionCleanupBlockers } from '../src/services/deletionRetentionPolicy.js';
describe('Deletion completion receipt gate', () => {
  const tracking = { policyApprovalReference: 'synthetic-policy', legalHolds: 'reviewed', backups: 'verified', backupCleanupReceipt: 'synthetic-backup', cloudinaryCleanup: 'verified', cloudinaryCleanupReceipt: 'synthetic-cloudinary', streamCleanup: 'verified', streamCleanupReceipt: 'synthetic-stream', manualReviewReference: 'synthetic-review' };
  it('accepts complete operator evidence references', () => expect(deletionCleanupBlockers(tracking)).to.deep.equal([]));
  for (const [field, code] of [['backupCleanupReceipt','BACKUP_CLEANUP_RECEIPT_REQUIRED'],['cloudinaryCleanupReceipt','CLOUDINARY_CLEANUP_RECEIPT_REQUIRED'],['streamCleanupReceipt','STREAM_CLEANUP_RECEIPT_REQUIRED']]) {
    it(`verified status cannot replace ${field}`, () => {
      expect(deletionCleanupBlockers({ ...tracking, [field]: '   ' })).to.include(code);
    });
  }
  it('does not impose manual policy approval on immediate erasure', () => {
    expect(deletionCleanupBlockers({ ...tracking, policyApprovalReference: '', manualReviewReference: '', cloudinaryCleanup: 'not_applicable', streamCleanup: 'not_applicable' })).to.deep.equal([]);
  });
});

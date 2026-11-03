// Prepared migration adapter. No startup hook, HTTP route, source fetch or
// provider revocation. A reviewed operator must supply approved recovery bytes.
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import PrivateAsset from '../models/PrivateAsset.js';
import Prescription from '../models/Prescription.js';
import { validateUploadContent, canReadPrivateAsset } from '../services/privateAssets.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const fields = new Set(['prescriptionSignature', 'prescriptionSeal']);
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function snapshotManifestHash(manifest) {
  return digest(JSON.stringify(['migrationId', 'prescriptionId', 'issuerId', 'field', 'sourceURLSHA256', 'providerAssetFingerprint', 'bytesSHA256', 'byteCount', 'mimeType'].map(key => [key, manifest[key]])));
}

export async function migratePrescriptionSnapshot({ manifest, approval, bytes }) {
  if (!manifest || !/^snapshot-[a-zA-Z0-9_-]{8,100}$/.test(manifest.migrationId || '') || !fields.has(manifest.field)) throw new Error('Invalid snapshot manifest');
  if (![manifest.prescriptionId, manifest.issuerId].every(value => mongoose.isValidObjectId(value))) throw new Error('Explicit prescription and issuer required');
  if (![manifest.sourceURLSHA256, manifest.providerAssetFingerprint, manifest.bytesSHA256].every(fingerprint)) throw new Error('Verified source and byte fingerprints required');
  if (typeof approval?.reference !== 'string' || !approval.reference.trim() || approval.reference.length > 200 || approval.manifestSHA256 !== snapshotManifestHash(manifest)) throw new Error('Exact manifest approval required');
  if (!Buffer.isBuffer(bytes) || bytes.length !== manifest.byteCount || digest(bytes) !== manifest.bytesSHA256) throw new Error('Recovery bytes do not match approved manifest');
  if (!['image/jpeg', 'image/png'].includes(manifest.mimeType)) throw new Error('Snapshot must be a supported raster image');
  validateUploadContent({ buffer: bytes, mimetype: manifest.mimeType });
  const prescriptionId = new mongoose.Types.ObjectId(manifest.prescriptionId), ownerId = new mongoose.Types.ObjectId(manifest.issuerId);
  const connection = Prescription.db;
  if (connection.readyState !== 1) throw new Error('Explicit connected migration database required');
  const session = await connection.startSession();
  const ledger = connection.db.collection('private_asset_migrations');
  const path = `psychiatristSnapshot.${manifest.field}`;
  let result;
  try {
    await session.withTransaction(async () => {
      const prior = await ledger.findOne({ _id: manifest.migrationId }, { session });
      const record = await Prescription.collection.findOne({ _id: prescriptionId }, { session });
      if (!record || String(record.psychiatristId) !== String(ownerId)) throw new Error('Prescription ownership changed');
      if (prior) {
        if (prior.manifestSHA256 !== approval.manifestSHA256 || prior.approvalReference !== approval.reference) throw new Error('Migration identity reused with different approval');
        const asset = await PrivateAsset.collection.findOne({ _id: prior.assetId }, { session });
        const stored = asset?.data ? Buffer.from(asset.data.buffer ?? asset.data) : null;
        if (!asset || record.psychiatristSnapshot?.[manifest.field] !== `/api/private-files/${asset._id}` || String(asset.prescriptionId) !== String(prescriptionId) || String(asset.ownerId) !== String(ownerId) || !stored || digest(stored) !== manifest.bytesSHA256) throw new Error('Committed migration requires reconciliation');
        result = prior; return;
      }
      const source = record.psychiatristSnapshot?.[manifest.field];
      if (typeof source !== 'string' || digest(source) !== manifest.sourceURLSHA256 || !/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(source)) throw new Error('Source pointer changed or is not an inventoried image');
      const assetId = new mongoose.Types.ObjectId();
      await PrivateAsset.collection.insertOne({ _id: assetId, ownerId, prescriptionId, purpose: 'prescription', name: `${manifest.field}.${manifest.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`, mimeType: manifest.mimeType, data: bytes, size: bytes.length, createdAt: new Date(), updatedAt: new Date() }, { session });
      const change = await Prescription.collection.updateOne({ _id: prescriptionId, psychiatristId: ownerId, [path]: source }, { $set: { [path]: `/api/private-files/${assetId}`, updatedAt: new Date() } }, { session });
      if (change.modifiedCount !== 1) throw new Error('Concurrent snapshot edit; no cutover committed');
      result = { _id: manifest.migrationId, manifestSHA256: approval.manifestSHA256, approvalReference: approval.reference, assetId, prescriptionId, field: manifest.field, sourceURLSHA256: manifest.sourceURLSHA256, providerAssetFingerprint: manifest.providerAssetFingerprint, bytesSHA256: manifest.bytesSHA256, state: 'private_cutover_pending_verification', publicSourceStatus: 'NOT_REVOKED', createdAt: new Date() };
      await ledger.insertOne(result, { session });
    });
  } finally { await session.endSession(); }
  // Re-read after commit. Failed verification preserves private bytes/pointer
  // and a pending ledger; a retry reuses them, never restores public access.
  const asset = await PrivateAsset.findById(result.assetId).select('+data');
  const record = await Prescription.findById(prescriptionId);
  const issuer = { _id: ownerId, role: 'counsellor' };
  const patient = { _id: record?.patientId, role: 'user' };
  if (!asset || digest(Buffer.from(asset.data)) !== manifest.bytesSHA256 || !await canReadPrivateAsset(asset, issuer) || await canReadPrivateAsset(asset, { _id: new mongoose.Types.ObjectId(), role: 'user' }) || Boolean(await canReadPrivateAsset(asset, patient)) !== (record?.identityVerification?.status === 'verified')) throw new Error('Post-cutover private authorization requires reconciliation');
  await ledger.updateOne({ _id: result._id, manifestSHA256: result.manifestSHA256 }, { $set: { state: 'private_cutover_verified', accessVerifiedAt: new Date() } });
  return { migrationId: result._id, state: 'private_cutover_verified', publicSourceStatus: 'NOT_REVOKED', sourceCDNDenialVerified: false };
}

// Real migration/private-delivery path on disposable fixtures only.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
if (process.env.AUDIT_ISOLATED_ENV !== 'true') throw new Error('Isolated preload required');
process.env.ACCESS_SECRET = randomBytes(32).toString('hex');
const { migratePrescriptionSnapshot, snapshotManifestHash } = await import('../../src/migrations/prescriptionSnapshotPrivacy.js');
const { default: Prescription } = await import('../../src/models/Prescription.js');
const { default: PrivateAsset } = await import('../../src/models/PrivateAsset.js');
const { default: User } = await import('../../src/models/userModel.js');
const { default: Session } = await import('../../src/models/sessionModel.js');
const { default: routes } = await import('../../src/routes/privateFiles.js');
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1' } });
const checks = [];
try {
  await mongoose.connect(mongo.getUri('audit_snapshot_remediation'));
  await Promise.all([Prescription.createCollection(), PrivateAsset.createCollection(), User.createCollection(), Session.createCollection(), mongoose.connection.db.createCollection('private_asset_migrations')]);
  const app = express(); app.use('/api/private-files', routes);
  const actors = {};
  for (const [name, role] of [['patient', 'user'], ['issuer', 'counsellor'], ['outsider', 'user']]) {
    const id = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: id, email: `${name}@example.test`, role, isActive: true });
    const session = await Session.create({ userId: id, refreshToken: `synthetic-${name}`, isActive: true });
    actors[name] = { id, session, token: jwt.sign({ userId: String(id), sessionId: String(session._id), role }, process.env.ACCESS_SECRET, { expiresIn: 600 }) };
  }
  const get = (path, name) => { const r = request(app).get(path); return name ? r.set('Authorization', `Bearer ${actors[name].token}`) : r; };
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const bytes = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const rx = new mongoose.Types.ObjectId();
  await Prescription.collection.insertOne({ _id: rx, patientId: actors.patient.id, psychiatristId: actors.issuer.id, identityVerification: { status: 'verified' }, psychiatristSnapshot: { prescriptionSignature: 'https://res.cloudinary.com/synthetic-only/image/upload/v1/signature.jpg', prescriptionSeal: 'https://res.cloudinary.com/synthetic-only/image/upload/v1/seal.jpg' } });
  for (const field of ['prescriptionSignature', 'prescriptionSeal']) {
    const source = (await Prescription.findById(rx)).psychiatristSnapshot[field];
    const manifest = { migrationId: `snapshot-synthetic_${field}`, prescriptionId: String(rx), issuerId: String(actors.issuer.id), field, sourceURLSHA256: sha(source), providerAssetFingerprint: sha(`synthetic-provider-${field}`), bytesSHA256: sha(bytes), byteCount: bytes.length, mimeType: 'image/jpeg' };
    const approval = { reference: 'SYNTHETIC_ONLY_NOT_COMPANY_APPROVAL', manifestSHA256: snapshotManifestHash(manifest) };
    await assert.rejects(migratePrescriptionSnapshot({ manifest, approval: { ...approval, manifestSHA256: '0'.repeat(64) }, bytes }));
    await assert.rejects(migratePrescriptionSnapshot({ manifest, approval: { ...approval, reference: ' ' }, bytes }));
    await assert.rejects(migratePrescriptionSnapshot({ manifest, approval, bytes: Buffer.from('corrupt synthetic bytes') }));
    assert.equal(await PrivateAsset.countDocuments(), field === 'prescriptionSignature' ? 0 : 1);
    checks.push(`${field}: mismatched/empty approval and corrupt recovery bytes refuse writes`);
    const result = await migratePrescriptionSnapshot({ manifest, approval, bytes });
    assert.equal(result.publicSourceStatus, 'NOT_REVOKED'); assert.equal(result.sourceCDNDenialVerified, false);
    await migratePrescriptionSnapshot({ manifest, approval, bytes });
    const count = await PrivateAsset.countDocuments(); assert.equal(count, field === 'prescriptionSignature' ? 1 : 2);
    checks.push(`${field}: atomic private copy/pointer/journal and idempotent replay`);
    const path = (await Prescription.findById(rx)).psychiatristSnapshot[field];
    for (const name of ['patient', 'issuer']) {
      const read = await get(path, name); assert.equal(read.status, 200); assert.equal(sha(read.body), sha(bytes));
    }
    assert.equal((await get(path)).status, 401); assert.equal((await get(path, 'outsider')).status, 404);
    assert.equal((await get(`${path}/link`, 'outsider')).status, 404);
    checks.push(`${field}: actual private HTTP bytes/hash and outsider/unauthenticated/link denial`);
    const stale = { ...manifest, migrationId: `snapshot-stale_${field}` };
    await assert.rejects(migratePrescriptionSnapshot({ manifest: stale, approval: { ...approval, manifestSHA256: snapshotManifestHash(stale) }, bytes }));
    assert.equal(await PrivateAsset.countDocuments(), count);
    checks.push(`${field}: stale pointer cutover aborts without duplicate bytes`);
    await Prescription.updateOne({ _id: rx }, { $set: { 'identityVerification.status': 'pending' } });
    assert.equal((await get(path, 'patient')).status, 404); assert.equal((await get(`${path}/link`, 'patient')).status, 404); assert.equal((await get(path, 'issuer')).status, 200);
    await Prescription.updateOne({ _id: rx }, { $set: { 'identityVerification.status': 'verified' } });
    checks.push(`${field}: patient verification gate preserved during recovery`);
    const link = await get(`${path}/link`, 'patient'); assert.equal(link.status, 200);
    assert.equal((await get(link.body.url)).status, 200);
    await Session.updateOne({ _id: actors.patient.session._id }, { $set: { isActive: false } });
    assert.equal((await get(link.body.url)).status, 401); assert.equal((await get(path, 'patient')).status, 401);
    await Session.updateOne({ _id: actors.patient.session._id }, { $set: { isActive: true } });
    checks.push(`${field}: real session revocation denies previously issued download ticket`);
    await Prescription.updateOne({ _id: rx }, { $unset: { [`psychiatristSnapshot.${field}`]: 1 } });
    assert.equal((await get(path, 'issuer')).status, 404);
    await assert.rejects(migratePrescriptionSnapshot({ manifest, approval, bytes }));
    assert.equal(await PrivateAsset.countDocuments(), count);
    await Prescription.updateOne({ _id: rx }, { $set: { [`psychiatristSnapshot.${field}`]: path } });
    checks.push(`${field}: detached pointer denies access; recovery restores private pointer only`);
  }
  console.log(JSON.stringify({ mode: 'isolated-real-migration-and-HTTP-delivery', status: 'PASS', checks, productionWrites: 0, providerMutations: 0,
    limits: ['Synthetic bytes/approval only; no real asset migration or source/CDN denial verified', 'Production execution requires exact company-approved manifest, protected recovery and separate rollout authorization'] }, null, 2));
} finally { await mongoose.disconnect(); await mongo.stop(); }

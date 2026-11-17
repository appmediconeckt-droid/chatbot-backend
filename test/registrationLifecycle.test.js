import { expect } from 'chai';
import mongoose from 'mongoose';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import authRoutes from '../src/routes/authRoutes.js';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import AccountDeletionJob from '../src/models/AccountDeletionJob.js';
import PrivateAsset from '../src/models/PrivateAsset.js';
import deletionNotification from '../src/services/deletionNotification.js';
import { requestAccountDeletion, processAccountDeletionJob } from '../src/services/accountDeletionService.js';
import { approvedRegistration } from './fixtures/registrationConsent.js';
const local = process.env.AUDIT_ISOLATED_ENV === 'true' && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI || '');
(local ? describe : describe.skip)('Synthetic enrollment and deletion lifecycle (disposable MongoDB)', function () {
  this.timeout(30000);
  const app = express(); app.use(express.json()); app.use('/api/auth', authRoutes);
  before(async () => { await mongoose.connect(process.env.MONGO_URI); await Promise.all(Object.values(mongoose.models).map(model => model.init())); });
  beforeEach(async () => { for (const model of Object.values(mongoose.models)) await model.deleteMany({}); });
  afterEach(async () => {
    sinon.restore();
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    expect(await User.countDocuments(), 'synthetic accounts removed').to.equal(0);
  });
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  const body = role => {
    const email = `${role}@example.test`;
    return { ...approvedRegistration, email, role, fullName: 'Synthetic enrollment', phoneNumber: '+919876543210', password: 'StrongPassword42!',
      emailVerificationToken: jwt.sign({ email, purpose: 'registration_email_verified' }, process.env.ACCESS_SECRET, { expiresIn: '10m' }),
      ...(role === 'counsellor' ? { qualification: 'MSc', specialization: 'Wellness', experience: 0, location: 'Synthetic city' } : {}) };
  };
  const approveSyntheticCleanup = async id => AccountDeletionJob.updateOne({ _id: id }, { $set: {
    'cleanupTracking.legalHolds': 'reviewed', 'cleanupTracking.backups': 'verified', 'cleanupTracking.backupCleanupReceipt': 'synthetic-only-backup-receipt',
    'cleanupTracking.cloudinaryCleanup': 'not_applicable', 'cleanupTracking.streamCleanup': 'not_applicable',
    nextAttemptAt: new Date(0),
    'cleanupTracking.manualReviewReference': 'synthetic-disposable-only', 'cleanupTracking.policyApprovalReference': 'synthetic-disposable-only',
  } });
  for (const role of ['user', 'counsellor']) {
    for (const patch of [{ termsAccepted: false }, { termsVersion: 'old' }, { termsContentSha256: 'forged' }, { age: 17 }, { age: undefined }, { age: 25, dateOfBirth: '2020-01-01' }]) {
      it(`${role}: email proof cannot bypass enrollment ${JSON.stringify(patch)}`, async () => {
        const res = await request(app).post('/api/auth/complete-registration').send({ ...body(role), ...patch });
        expect(res.status).to.equal(400); expect(await User.countDocuments()).to.equal(0); expect(await Session.countDocuments()).to.equal(0);
      });
    }
    it(`${role}: creates, persists consent, logs in and deletes the synthetic account with verified cleanup`, async () => {
      const registration = await request(app).post('/api/auth/complete-registration').send(body(role));
      expect(registration.status, JSON.stringify(registration.body)).to.equal(201);
      const user = await User.findOne({ email: body(role).email });
      expect(user.registrationConsent.version).to.equal(approvedRegistration.termsVersion);
      expect(user.registrationConsent.contentSha256).to.equal(approvedRegistration.termsContentSha256);
      expect(user.registrationConsent.acceptedAt).to.be.instanceOf(Date);
      expect(user.registrationConsent.channel).to.equal('email');
      const login = await request(app).post('/api/auth/login').send({ email: user.email, password: body(role).password, role });
      expect(login.status, JSON.stringify(login.body)).to.equal(200);
      for (const patch of [{ age: 17 }, { dateOfBirth: '2020-01-01' }, { age: [18] }]) {
        const update = await request(app).patch(`/api/auth/update/${user._id}`).set('Authorization', `Bearer ${login.body.accessToken}`).send(patch);
        expect(update.status, JSON.stringify(update.body)).to.equal(400);
        expect((await User.findById(user._id)).age).to.equal(25);
      }
      const oldConsent = user.registrationConsent.toObject();
      await User.updateOne({ _id: user._id }, { $set: { 'registrationConsent.version': 'forged' } });
      expect((await User.findById(user._id)).registrationConsent.toObject()).to.deep.equal(oldConsent);

      await PrivateAsset.create({ ownerId: user._id, purpose: 'certification', name: 'synthetic.txt', mimeType: 'text/plain', data: Buffer.from('synthetic'), size: 9 });
      const send = sinon.stub(deletionNotification, 'send').resolves();
      const job = await requestAccountDeletion(user);
      expect((await processAccountDeletionJob()).status).to.equal('account_deleted'); expect(send.called).to.equal(false);
      await approveSyntheticCleanup(user._id);
      expect((await processAccountDeletionJob()).status).to.equal('completed');
      expect(await User.exists({ _id: user._id })).to.equal(null);
      expect(await PrivateAsset.countDocuments({ ownerId: user._id })).to.equal(0);
      expect(await Session.countDocuments({ userId: user._id })).to.equal(0);
      expect((await AccountDeletionJob.findById(user._id)).localCleanupVerifiedAt).to.be.instanceOf(Date);
      expect(send.calledOnceWithExactly(user.email)).to.equal(true);
    });
    for (const patch of [{ termsAccepted: false }, { age: 17 }, { termsContentSha256: 'forged' }]) {
      it(`${role}: verified Google identity cannot bypass enrollment ${JSON.stringify(patch)}`, async () => {
        sinon.stub(OAuth2Client.prototype, 'verifyIdToken').resolves({ getPayload: () => ({ sub: `synthetic-${role}`, email: `${role}@example.test`, email_verified: true }) });
        const res = await request(app).post('/api/auth/google').send({ ...approvedRegistration, ...patch, role, idToken: 'synthetic-token' });
        expect(res.status).to.equal(400); expect(await User.countDocuments()).to.equal(0); expect(await Session.countDocuments()).to.equal(0);
      });
    }
  }
  it('rolls back all local erasure when completion verification fails', async () => {
    expect((await request(app).post('/api/auth/complete-registration').send(body('user'))).status).to.equal(201);
    const user = await User.findOne({ email: body('user').email });
    const asset = await PrivateAsset.create({ ownerId: user._id, purpose: 'certification', name: 'synthetic.txt', mimeType: 'text/plain', data: Buffer.from('synthetic'), size: 9 });
    const job = await requestAccountDeletion(user); await approveSyntheticCleanup(user._id);
    sinon.stub(PrivateAsset, 'countDocuments').returns({ session: async () => 1 });
    const send = sinon.stub(deletionNotification, 'send').resolves();
    expect((await processAccountDeletionJob()).status).to.equal('retry');
    expect(await User.exists({ _id: user._id })).not.to.equal(null);
    expect(await PrivateAsset.exists({ _id: asset._id })).not.to.equal(null);
    expect((await AccountDeletionJob.findById(user._id)).localCleanupVerifiedAt).to.equal(undefined);
    expect(send.called).to.equal(false);
  });
  it('missing account and relationship inventory cannot falsely certify erasure', async () => {
    const id = new mongoose.Types.ObjectId();
    await AccountDeletionJob.create({ _id: id, status: 'pending', retentionUntil: new Date(0), cleanupContext: { chats: [] }, completionEmail: 'synthetic@example.test' });
    await approveSyntheticCleanup(id);
    const send = sinon.stub(deletionNotification, 'send').resolves();
    expect((await processAccountDeletionJob()).status).to.equal('retry'); expect(send.called).to.equal(false);
  });
});

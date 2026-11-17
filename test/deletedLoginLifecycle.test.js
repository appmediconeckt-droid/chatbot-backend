import { expect } from 'chai';
import sinon from 'sinon';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import RefreshToken from '../src/models/refreshTokenModel.js';
import AccountDeletionJob from '../src/models/AccountDeletionJob.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import LoginChallenge from '../src/models/loginChallengeModel.js';
import { loginUser, googleAuth, completeRegistration, deleteUser, logoutOtherDevicesAndSendOTP, verifyLoginOTP, refreshAccessToken } from '../src/controllers/authController.js';
import { requestAccountDeletion, processAccountDeletionJob } from '../src/services/accountDeletionService.js';
import deletionNotification from '../src/services/deletionNotification.js';
import otpService from '../src/services/otpService.js';
import { approvedRegistration } from './fixtures/registrationConsent.js';

const isolated = process.env.AUDIT_ISOLATED_ENV === 'true' && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI || '');
const invoke = async (handler, body = {}, extra = {}) => {
  const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, set() { return this; }, cookie() { return this; } };
  await handler({ body, cookies: {}, headers: {}, ...extra }, res); return res;
};
(isolated ? describe : describe.skip)('Deleted login and re-registration (disposable MongoDB only)', function () {
  this.timeout(30000);
  const email = 'deleted-fixture@example.test', password = 'OriginalPassword42!';
  let user, google;
  before(async () => { await mongoose.connect(process.env.MONGO_URI); await Promise.all(Object.values(mongoose.models).map(model => model.init())); });
  beforeEach(async () => {
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    user = await User.create({ email, fullName: 'Synthetic account', phoneNumber: '+919876543210', password: await bcrypt.hash(password, 4), role: 'user', age: 25, isActive: true, locationData: { current: { type: 'Point', coordinates: [0, 0] } } });
    google = sinon.stub(OAuth2Client.prototype, 'verifyIdToken').resolves({ getPayload: () => ({ email, sub: 'synthetic-google-sub', email_verified: true, name: 'Synthetic Google' }) });
  });
  afterEach(() => sinon.restore());
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  const credentials = (patch = {}) => ({ email, password, role: 'user', ...patch });
  const oauth = (patch = {}) => ({ idToken: 'synthetic-verified-token', role: 'user', mode: 'login', ...patch });
  const registration = (patch = {}) => ({ ...approvedRegistration, email, fullName: 'Fresh account', phoneNumber: '+919876543210', password: 'FreshPassword42!', confirmPassword: 'FreshPassword42!', role: 'user', emailVerificationToken: jwt.sign({ email, purpose: 'registration_email_verified' }, process.env.ACCESS_SECRET, { expiresIn: '10m' }), ...patch });
  it('active password login issues an active session', async () => {
    const result = await invoke(loginUser, credentials({ email: ` ${email.toUpperCase()} ` }));
    expect(result.code).to.equal(200); expect(result.body.success).to.equal(true);
    const claims = jwt.verify(result.body.accessToken, process.env.ACCESS_SECRET);
    expect(await Session.exists({ _id: claims.sessionId, userId: user._id, isActive: true })).not.to.equal(null);
  });
  it('active Google login links the verified identity and issues a session', async () => {
    const result = await invoke(googleAuth, oauth());
    expect(result.code).to.equal(200);
    expect((await User.findById(user._id)).googleId).to.equal('synthetic-google-sub');
    expect(await Session.countDocuments({ userId: user._id, isActive: true })).to.equal(1);
  });
  it('missing, wrong-password, inactive, pending and wrong-role/wrong-password failures have identical public responses', async () => {
    const results = [];
    results.push(await invoke(loginUser, credentials({ email: 'missing@example.test' })));
    results.push(await invoke(loginUser, credentials({ password: 'wrong' })));
    results.push(await invoke(loginUser, credentials({ role: 'counsellor', password: 'wrong' })));
    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
    results.push(await invoke(loginUser, credentials()));
    await User.updateOne({ _id: user._id }, { $set: { isActive: true } });
    await AccountDeletionJob.create({ _id: user._id, status: 'pending' });
    results.push(await invoke(loginUser, credentials()));
    for (const result of results) {
      expect(result.code).to.equal(401); expect(result.body).to.deep.equal(results[0].body);
      expect(JSON.stringify(result.body)).not.to.match(/delet|deactivat|not found|registered|actualRole|userId|@/i);
    }
    expect(await Session.countDocuments()).to.equal(0);
  });
  it('Google-only accounts fail password login generically instead of returning a server error', async () => {
    await User.updateOne({ _id: user._id }, { $set: { googleId: 'synthetic-google-sub', authProvider: 'google' }, $unset: { password: 1 } });
    const result = await invoke(loginUser, credentials());
    expect(result.code).to.equal(401); expect(result.body.code).to.equal('AUTHENTICATION_FAILED');
  });
  for (const status of ['pending', 'processing', 'retry', 'waiting_retention', 'blocked_cleanup', 'completed']) {
    it(`${status}: no password/Google login, identity linking, reactivation or duplicate registration`, async () => {
      // Also test a crash before isActive was set false: the durable job is authoritative.
      await AccountDeletionJob.create({ _id: user._id, status });
      const snapshot = (await User.findById(user._id)).toObject();
      expect((await invoke(loginUser, credentials())).code).to.equal(401);
      for (const mode of ['login', 'signup']) {
        const result = await invoke(googleAuth, oauth({ ...approvedRegistration, mode }));
        expect(result.code).to.equal(401); expect(result.body.code).to.equal('AUTHENTICATION_FAILED');
      }
      expect((await User.findById(user._id)).toObject()).to.deep.equal(snapshot);
      expect((await invoke(completeRegistration, registration())).code).to.equal(409);
      expect(await User.countDocuments({ email })).to.equal(1); expect(await Session.countDocuments()).to.equal(0);
    });
  }
  it('deleted login never recreates the account even with signup fields accidentally supplied', async () => {
    await requestAccountDeletion(user); await processAccountDeletionJob();
    expect((await invoke(loginUser, credentials())).code).to.equal(401);
    expect((await invoke(googleAuth, oauth({ ...approvedRegistration }))).code).to.equal(401);
    expect(await User.countDocuments({ email })).to.equal(0); expect(await Session.countDocuments()).to.equal(0);
  });
  it('Google signup creates a fresh ID after local erasure; the old cleanup job cannot erase the new account', async () => {
    const oldId = user._id;
    const chat = await Chat.create({ userId: oldId, counselorId: new mongoose.Types.ObjectId(), status: 'active' });
    await Message.create({ chatId: chat._id, senderId: oldId, senderRole: 'user', content: 'Synthetic old history' });
    const deletion = await invoke(deleteUser, {}, { user: { _id: oldId } });
    expect(deletion.code).to.equal(200); expect(deletion.body.localDataDeleted).to.equal(true);
    expect(await User.findById(oldId)).to.equal(null); expect(await Session.countDocuments({ userId: oldId })).to.equal(0);
    expect(await Chat.countDocuments()).to.equal(0); expect(await Message.countDocuments()).to.equal(0);
    const noConsent = await invoke(googleAuth, oauth({ mode: 'signup', age: 25 }));
    expect(noConsent.code).to.equal(400); expect(await User.countDocuments()).to.equal(0);
    const created = await invoke(googleAuth, oauth({ ...approvedRegistration, mode: 'signup' }));
    expect(created.code).to.equal(200); const fresh = await User.findOne({ email });
    expect(String(fresh._id)).not.to.equal(String(oldId)); expect(fresh.isActive).to.equal(true);
    expect(fresh.registrationConsent.version).to.equal(approvedRegistration.termsVersion);
    expect(fresh.registrationConsent.channel).to.equal('google');
    sinon.stub(deletionNotification, 'send').resolves();
    await AccountDeletionJob.updateOne({ _id: oldId }, { $set: { nextAttemptAt: new Date(0), 'cleanupTracking.legalHolds': 'reviewed', 'cleanupTracking.backups': 'verified', 'cleanupTracking.backupCleanupReceipt': 'synthetic', 'cleanupTracking.cloudinaryCleanup': 'not_applicable', 'cleanupTracking.streamCleanup': 'not_applicable' } });
    expect((await processAccountDeletionJob()).status).to.equal('completed');
    expect(await User.exists({ _id: fresh._id, isActive: true })).not.to.equal(null);
    expect(await Session.countDocuments({ userId: fresh._id, isActive: true })).to.equal(1);
  });
  it('email re-registration needs ownership proof and current consent, creates a new ID/password and does not restore history', async () => {
    const oldId = user._id;
    await requestAccountDeletion(user); await processAccountDeletionJob();
    expect((await invoke(completeRegistration, registration({ emailVerificationToken: undefined }))).code).to.equal(400);
    expect((await invoke(completeRegistration, registration({ termsAccepted: false }))).code).to.equal(400);
    const created = await invoke(completeRegistration, registration());
    expect(created.code).to.equal(201); const fresh = await User.findOne({ email });
    expect(String(fresh._id)).not.to.equal(String(oldId)); expect(fresh.registrationConsent.channel).to.equal('email');
    expect((await invoke(loginUser, credentials())).code).to.equal(401);
    expect((await invoke(loginUser, credentials({ password: 'FreshPassword42!' }))).code).to.equal(200);
  });
  it('pending/deleted accounts cannot obtain login OTPs or refresh old sessions', async () => {
    const login = await invoke(loginUser, credentials());
    const send = sinon.stub(otpService, 'sendLoginOTP').resolves();
    await requestAccountDeletion(user);
    for (const handler of [logoutOtherDevicesAndSendOTP, verifyLoginOTP]) {
      const result = await invoke(handler, credentials({ otp: '123456' }));
      expect(result.code).to.equal(401); expect(result.body.code).to.equal('AUTHENTICATION_FAILED');
    }
    expect((await invoke(refreshAccessToken, { refreshToken: login.body.refreshToken })).code).to.equal(401);
    expect(send.called).to.equal(false); expect(await LoginChallenge.countDocuments()).to.equal(0);
    await processAccountDeletionJob();
    expect((await invoke(logoutOtherDevicesAndSendOTP, credentials())).code).to.equal(401);
    expect(await Session.countDocuments({ userId: user._id })).to.equal(0);
    expect(await RefreshToken.countDocuments({ userId: user._id })).to.equal(0);
    const job = await AccountDeletionJob.findById(user._id);
    expect(job.localCleanupVerifiedAt).to.be.instanceOf(Date); expect(job.status).to.equal('blocked_cleanup');
  });
});

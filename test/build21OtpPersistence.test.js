import { approvedRegistration } from './fixtures/registrationConsent.js';
import { expect } from 'chai';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import sinon from 'sinon';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import authRoutes from '../src/routes/authRoutes.js';
import User from '../src/models/userModel.js';
import OTP from '../src/models/otpModel.js';
import Session from '../src/models/sessionModel.js';
import AccountDeletionJob from '../src/models/AccountDeletionJob.js';
import { verifyOtp } from '../src/middleware/verifyOtp.js';
const local = process.env.AUDIT_ISOLATED_ENV === 'true' && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI || '');
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, cookie() { return this; } });
(local ? describe : describe.skip)('Build 21 OTP replay persistence (disposable MongoDB only)', function () {
  this.timeout(30000);
  before(async () => { await mongoose.connect(process.env.MONGO_URI); await Promise.all([User.init(), OTP.init(), Session.init(), AccountDeletionJob.init()]); });
  after(async () => mongoose.disconnect());
  beforeEach(async () => { await Promise.all([User.deleteMany({}), OTP.deleteMany({}), Session.deleteMany({}), AccountDeletionJob.deleteMany({})]); });
  const app = express(); app.use(express.json()); app.use('/api/auth', authRoutes);
  for (const role of ['user', 'counsellor']) {
    const fixture = () => User.create({ fullName: 'Synthetic account', email: `${role}@example.test`,
      role, authProvider: 'google', googleId: `fixture-${role}`, isActive: true,
      locationData: { current: { type: 'Point', coordinates: [0, 0] }, history: [] } });
    it(`${role}: signed-proof registration through the real HTTP route ignores GPS`, async () => {
      const email = `signup-${role}@example.test`;
      const emailVerificationToken = jwt.sign({ email, purpose: 'registration_email_verified' }, process.env.ACCESS_SECRET, { expiresIn: '10m' });
      const res = await request(app).post('/api/auth/complete-registration').send({
        ...approvedRegistration, fullName: 'Synthetic signup', email, phoneNumber: '+919876543210', password: 'StrongPassword42!',
        role, emailVerificationToken, latitude: 12, longitude: 77,
        ...(role === 'counsellor' ? { qualification: 'MSc', specialization: 'Wellness', experience: 0, location: 'Bengaluru, Karnataka' } : {}),
      });
      expect(res.status).to.equal(201); expect(res.body.success).to.equal(true);
      const stored = await User.findOne({ email });
      expect(stored.role).to.equal(role); expect(stored.locationData.history).to.have.length(0);
      expect(stored.locationData.current.coordinates).to.deep.equal([0, 0]);
      if (role === 'counsellor') { expect(stored.experience).to.equal(0); expect(stored.location).to.equal('Bengaluru, Karnataka'); }
    });
    it(`${role}: HTTP login, role protection, profile, refresh replay and logout integrate`, async () => {
      const user = await fixture(); user.password = await bcrypt.hash('StrongPassword42!', 4); await user.save();
      const wrong = await request(app).post('/api/auth/login').send({ email: user.email, password: 'StrongPassword42!', role: role === 'user' ? 'counsellor' : 'user' });
      expect(wrong.status).to.equal(403);
      const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'StrongPassword42!', role });
      expect(login.status).to.equal(200); expect(login.body.success).to.equal(true);
      const profile = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(profile.status).to.equal(200);
      const refresh = await request(app).post('/api/auth/refresh-token').send({ refreshToken: login.body.refreshToken });
      expect(refresh.status).to.equal(200); expect(refresh.body.refreshToken).not.to.equal(login.body.refreshToken);
      const replay = await request(app).post('/api/auth/refresh-token').send({ refreshToken: login.body.refreshToken });
      expect(replay.status).to.equal(401);
      const logout = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${refresh.body.accessToken}`).send({ refreshToken: refresh.body.refreshToken });
      expect(logout.status).to.equal(200);
      const denied = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refresh.body.accessToken}`);
      expect(denied.status).to.equal(401);
    });
    it(`${role}: concurrent refresh requests rotate a credential only once`, async () => {
      const user = await fixture(); user.password = await bcrypt.hash('StrongPassword42!', 4); await user.save();
      const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'StrongPassword42!', role });
      expect(login.status).to.equal(200);
      const results = await Promise.all([0, 1].map(() => request(app).post('/api/auth/refresh-token').send({ refreshToken: login.body.refreshToken })));
      expect(results.map(res => res.status).sort()).to.deep.equal([200, 401]);
      const session = await Session.findOne({ userId: user._id, isActive: true });
      expect(session.refreshToken).to.equal(results.find(res => res.status === 200).body.refreshToken);
    });
    it(`${role}: concurrent OTP replay creates exactly one session without GPS`, async () => {
      const user = await fixture();
      await OTP.create({ userId: user._id, otp: '654321', expiresAt: new Date(Date.now() + 60000) });
      const responses = [response(), response()];
      await Promise.all(responses.map(res => verifyOtp({ body: { email: ` ${user.email.toUpperCase()} `, otp: '654321', latitude: 12, longitude: 77 } }, res)));
      expect(responses.map(res => res.code).sort()).to.deep.equal([200, 400]);
      expect(await Session.countDocuments({ userId: user._id, isActive: true })).to.equal(1);
      expect(await OTP.countDocuments({ userId: user._id })).to.equal(0);
      const stored = await User.findById(user._id);
      expect(stored.locationData.history).to.have.length(0);
      expect(stored.locationData.current.coordinates).to.deep.equal([0, 0]);
      expect(stored.locationConsent).not.to.equal(true);
    });
    it(`${role}: an expired OTP cannot issue a session even before database cleanup`, async () => {
      const user = await fixture();
      await OTP.create({ userId: user._id, otp: '654321', expiresAt: new Date(Date.now() - 1000) });
      const res = response();
      await verifyOtp({ body: { email: user.email, otp: '654321' } }, res);
      expect(res.code).to.equal(400);
      expect(await Session.countDocuments({ userId: user._id })).to.equal(0);
    });
  }
  describe('Apple identity verification with a synthetic signing key and mocked Apple JWKS', () => {
    let privateKey, publicJwk;
    before(async () => {
      const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey;
      publicJwk = { ...await exportJWK(keys.publicKey), kid: 'build21-fixture', alg: 'RS256', use: 'sig' };
    });
    beforeEach(() => sinon.stub(globalThis, 'fetch').resolves(new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })));
    afterEach(() => sinon.restore());
    const token = (role, audience = 'com.mindcrawller.humaeli', expires = '5m') => new SignJWT({ email: `apple-${role}@example.test`, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'build21-fixture' }).setIssuer('https://appleid.apple.com')
      .setAudience(audience).setSubject(`apple-fixture-${role}`).setIssuedAt().setExpirationTime(expires).sign(privateKey);
    for (const role of ['user', 'counsellor']) it(`${role}: verifies signature and creates an Apple session without GPS`, async () => {
      const res = await request(app).post('/api/auth/apple-login').send({ ...approvedRegistration, role, identityToken: await token(role), latitude: 12, longitude: 77 });
      expect(res.status).to.equal(200); expect(res.body.success).to.equal(true);
      const user = await User.findOne({ appleId: `apple-fixture-${role}` });
      expect(user.role).to.equal(role); expect(user.locationData.history).to.have.length(0);
      expect(user.locationData.current.coordinates).to.deep.equal([0, 0]);
      expect(await Session.countDocuments({ userId: user._id, isActive: true })).to.equal(1);
    });
    for (const role of ['user', 'counsellor']) {
      for (const patch of [{ age: 17 }, { age: undefined }, { termsAccepted: false }, { termsVersion: 'old' }, { termsContentSha256: 'forged' }]) {
        it(`${role}: verified Apple identity cannot bypass enrollment ${JSON.stringify(patch)}`, async () => {
          const res = await request(app).post('/api/auth/apple-login').send({ ...approvedRegistration, ...patch, role, identityToken: await token(role) });
          expect(res.status).to.equal(400);
          expect(await User.countDocuments()).to.equal(0);
          expect(await Session.countDocuments()).to.equal(0);
        });
      }
    }
    it('rejects a validly signed token for another audience', async () => {
      const res = await request(app).post('/api/auth/apple-login').send({ role: 'user', identityToken: await token('user', 'other-app') });
      expect(res.status).to.equal(401); expect(await User.countDocuments({})).to.equal(0);
    });
    it('rejects an expired signed identity token', async () => {
      const res = await request(app).post('/api/auth/apple-login').send({ role: 'user', identityToken: await token('user', 'com.mindcrawller.humaeli', Math.floor(Date.now() / 1000) - 60) });
      expect(res.status).to.equal(401); expect(await User.countDocuments({})).to.equal(0);
    });
  });

});

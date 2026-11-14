import { expect } from 'chai';
import sinon from 'sinon';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { completeRegistration, loginUser, googleAuth, appleLogin, relinkGoogleAccount } from '../src/controllers/authController.js';
import { verifyOtp } from '../src/middleware/verifyOtp.js';
import { generateOtp } from '../src/utils/generateOtp.js';
import { resendOtp } from '../src/utils/resendOtp.js';
import User from '../src/models/userModel.js';
import OTP from '../src/models/otpModel.js';
import RegistrationOTP from '../src/models/registrationOtpModel.js';
import bcrypt from 'bcryptjs';

const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis(), cookie: sinon.stub().returnsThis() });
describe('Build 21 authentication validation', () => {
  afterEach(() => sinon.restore());
  it('keeps a zero-experience consultant and their declared city without GPS', async () => {
    sinon.stub(User, 'findOne').resolves(null);
    const create = sinon.stub(User, 'create').callsFake(async data => ({ ...data, _id: '100000000000000000000001', toJSON: () => ({ role: data.role }) }));
    sinon.stub(RegistrationOTP, 'deleteMany').resolves({});
    sinon.stub(bcrypt, 'hash').resolves('hashed-fixture');
    const email = 'consultant@example.test';
    const body = { email, fullName: 'Synthetic Consultant', phoneNumber: '+919876543210',
      password: 'StrongPassword42!', role: 'counsellor', qualification: 'MSc',
      specialization: 'Wellness', experience: 0, location: 'Bengaluru, Karnataka',
      emailVerificationToken: jwt.sign({ email, purpose: 'registration_email_verified' }, process.env.ACCESS_SECRET, { expiresIn: '10m' }) };
    const res = response();
    await completeRegistration({ body }, res);
    expect(res.status.lastCall.args[0]).to.equal(201);
    expect(res.json.firstCall.args[0].success).to.equal(true);
    const data = create.firstCall.args[0];
    expect(data.role).to.equal('counsellor');
    expect(data.experience).to.equal(0);
    expect(data.location).to.equal(body.location);
    expect(data.locationData.history).to.deep.equal([]);
    expect(data.locationData.current.coordinates).to.deep.equal([0, 0]);
    expect(data).not.to.have.property('latitude');
  });
  for (const body of [{ email: {}, password: 'x', role: 'user' }, { email: 'a@example.test', password: {}, role: 'user' }, { email: 'a@example.test', password: 'x', role: 'admin' }]) {
    it(`rejects malformed password login ${JSON.stringify(body)} before querying`, async () => {
      const lookup = sinon.stub(User, 'findOne'); const res = response();
      await loginUser({ body }, res);
      expect(res.status.calledWith(400)).to.equal(true); expect(lookup.called).to.equal(false);
    });
  }
  for (const handler of [googleAuth, appleLogin]) it(`${handler.name} rejects an unsupported role before provider or database access`, async () => {
    const lookup = sinon.stub(User, 'findOne'); const res = response();
    await handler({ body: { role: 'admin', idToken: 'fixture', identityToken: 'fixture' } }, res);
    expect(res.status.calledWith(400)).to.equal(true); expect(lookup.called).to.equal(false);
  });
  for (const handler of [googleAuth, relinkGoogleAccount]) it(`${handler.name} fails closed without a configured Google audience`, async () => {
    const previous = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      const verifier = sinon.stub(OAuth2Client.prototype, 'verifyIdToken'); const res = response();
      await handler({ user: { _id: 'fixture' }, body: { idToken: 'fixture', role: 'user' } }, res);
      expect(res.status.calledWith(503)).to.equal(true); expect(verifier.called).to.equal(false);
    } finally { if (previous !== undefined) process.env.GOOGLE_CLIENT_ID = previous; }
  });
  for (const handler of [verifyOtp, generateOtp, resendOtp]) it(`${handler.name} rejects object-valued email input before querying`, async () => {
    const lookup = sinon.stub(User, 'findOne'); const res = response();
    await handler({ body: { email: { $ne: null }, otp: { $ne: null } } }, res);
    expect(res.status.calledWith(400)).to.equal(true); expect(lookup.called).to.equal(false);
  });
  it('rejects object-valued OTP before querying', async () => {
    const lookup = sinon.stub(User, 'findOne'); const res = response();
    await verifyOtp({ body: { email: 'normal@example.test', otp: { $ne: null } } }, res);
    expect(res.status.calledWith(400)).to.equal(true); expect(lookup.called).to.equal(false);
  });
  it('rejects a deactivated account without consuming an OTP', async () => {
    sinon.stub(User, 'findOne').resolves({ _id: '100000000000000000000001', isActive: false });
    const consume = sinon.stub(OTP, 'findOneAndDelete'); const res = response();
    await verifyOtp({ body: { email: 'normal@example.test', otp: '123456' } }, res);
    expect(res.status.calledWith(401)).to.equal(true); expect(consume.called).to.equal(false);
  });
});

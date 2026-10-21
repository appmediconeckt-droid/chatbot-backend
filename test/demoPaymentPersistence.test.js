import { expect } from 'chai';
import mongoose from 'mongoose';
import User from '../src/models/userModel.js';
import Transaction from '../src/models/transactionModel.js';
import Appointment from '../src/models/appointmentModel.js';
import CounselorEarning from '../src/models/CounselorEarning.js';
import { chargeCallByDuration } from '../src/services/paidSessionService.js';
import Notification from '../src/models/Notification.js';
import { simulatePayment, requestWithdrawal, getWalletData } from '../src/controllers/walletController.js';
import { book } from '../src/controllers/appointmentController.js';
const res = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
// These persistence tests must never use the .env external database.
const local = /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI || '');
(local ? describe : describe.skip)('Demo payment persistence (local MongoDB only)', function () {
 let user, counselor;
 before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await Transaction.init();
 });
 beforeEach(async () => {
  const fixture = role => ({ fullName: 'Demo payment fixture', email: `demo-${new mongoose.Types.ObjectId()}@example.test`, googleId: String(new mongoose.Types.ObjectId()), authProvider: 'google', role, profileCompleted: true, isActive: true, walletBalance: 900, demoWalletBalance: 0, demoPaymentsEnabled: true, locationData: { current: { type: 'Point', coordinates: [77, 12] } } });
  user = await User.create(fixture('user')); counselor = await User.create(fixture('counsellor'));
 });
 afterEach(async () => {
  const ids = [user._id, counselor._id];
  await Promise.all([Transaction.deleteMany({ userId: { $in: ids } }), Appointment.deleteMany({ patient: user._id }), Notification.deleteMany({ recipientId: { $in: ids } })]);
  await User.deleteMany({ _id: { $in: ids } });
 });
 after(async () => mongoose.disconnect());
 it('persists concurrent retries as one demo credit without changing real funds', async () => {
  const request = { user, body: { amount: 200, requestId: 'demo_persist_001' } };
  const responses = Array.from({ length: 4 }, res);
  await Promise.all(responses.map(r => simulatePayment(request, r)));
  responses.forEach(r => expect(r.body).to.include({ success: true, paymentMode: 'demo', status: 'demo_completed', redeemable: false }));
  const persisted = await User.findById(user._id);
  expect(persisted.demoWalletBalance).to.equal(200); expect(persisted.walletBalance).to.equal(900);
  const records = await Transaction.find({ userId: user._id });
  expect(records).to.have.length(1); expect(records[0].status).to.equal('demo_completed');
  expect(records[0].razorpayPaymentId).to.equal(undefined);
 });
 it('stores the appointment simulation and keeps confirmation pending', async () => {
  const response = res();
  await book({ user, body: { counselorId: counselor._id, date: new Date(Date.now() + 86400000).toISOString(), paymentMode: "demo", demoAmount: 1155 } }, response);
  expect(response.statusCode).to.equal(201);
  const appointment = await Appointment.findById(response.body._id);
  expect(appointment.status).to.equal('pending'); expect(appointment.paymentMode).to.equal('demo');
  const transaction = await Transaction.findById(appointment.paymentTransactionId);
  expect(transaction.status).to.equal('demo_completed'); expect(transaction.redeemable).to.equal(false);
  expect(String(transaction.appointmentId)).to.equal(String(appointment._id));
  expect((await User.findById(user._id)).walletBalance).to.equal(900);
 });
 it('cannot redeem demo funds or create a withdrawal record', async () => {
  await User.updateOne({ _id: counselor._id }, { $set: { demoWalletBalance: 1000 } });
  const response = res(); await requestWithdrawal({ user: counselor, body: { amount: 1000 } }, response);
  expect(response.statusCode).to.equal(403); expect(await Transaction.countDocuments({ userId: counselor._id })).to.equal(0);
  const persisted = await User.findById(counselor._id);
  expect(persisted.demoWalletBalance).to.equal(1000); expect(persisted.walletBalance).to.equal(900);
  expect(persisted.payoutAccount?.accountNumber).not.to.be.ok;
 });
 it('ordinary users cannot enable simulation or fabricate balances via JSON', async () => {
  user.demoPaymentsEnabled = false; user.demoWalletBalance = 500; await user.save();
  const blocked = res();
  await simulatePayment({ user, body: { amount: 200, requestId: 'public_attempt', demoPaymentsEnabled: true } }, blocked);
  expect(blocked.statusCode).to.equal(403);
  const wallet = res(); await getWalletData({ user, query: {} }, wallet);
  expect(wallet.body).to.include({ paymentMode: 'free', paymentsEnabled: false, simulationEnabled: false, balance: 0 });
  expect(wallet.body.transactions).to.deep.equal([]);
  expect(await Transaction.countDocuments({ userId: user._id })).to.equal(0);
 });
 it('ordinary appointments and calls remain free with no financial records', async () => {
  user.demoPaymentsEnabled = false; await user.save();
  const response = res();
  await book({ user, body: { counselorId: counselor._id, date: new Date(Date.now() + 86400000).toISOString(), paymentMode: 'free' } }, response);
  expect(response.statusCode).to.equal(201);
  expect(response.body.paymentMode).to.equal('free');
  expect(response.body.paymentStatus).to.equal('not_required');
  expect(response.body.paymentTransactionId).to.equal(null);
  const billing = await chargeCallByDuration({ userId: user._id, counselorId: counselor._id, callId: 'free-call', durationSeconds: 60, sessionType: 'voice' });
  expect(billing).to.include({ paymentMode: 'free', amount: 0, transaction: null });
  expect(await Transaction.countDocuments({ userId: user._id })).to.equal(0);
  const spoofed = res();
  await book({ user, body: { counselorId: counselor._id, date: new Date(Date.now() + 86400000).toISOString(), paymentMode: 'demo' } }, spoofed);
  expect(spoofed.statusCode).to.equal(403);
 });
 it('review simulations cannot accrue earnings for a real consultant account', async () => {
  counselor.demoPaymentsEnabled = false; await counselor.save();
  user.demoWalletBalance = 1000; await user.save();
  await chargeCallByDuration({ userId: user._id, counselorId: counselor._id, callId: 'restricted-earning-call', durationSeconds: 60, sessionType: 'voice' });
  expect(await CounselorEarning.countDocuments({ counselorId: counselor._id })).to.equal(0);
  const owner = await User.findById(counselor._id);
  expect(owner.demoWalletBalance).to.equal(0);
  expect(owner.walletBalance).to.equal(900);
 });

});

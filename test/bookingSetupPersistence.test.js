import { expect } from 'chai';
import mongoose from 'mongoose';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import User from '../src/models/userModel.js';
import { book } from '../src/controllers/appointmentController.js';
import { ensureBookingIndexes } from '../src/services/ensureBookingIndexes.js';
import { bookingIndexesReady } from '../src/services/appointmentIndexes.js';
import { inspectBookingMigration } from '../src/migrations/bookingIndexes.js';

const local = process.env.AUDIT_ISOLATED_ENV === 'true' && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI || '');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
(local ? describe : describe.skip)('Production booking setup recovery (local database only)', function () {
  this.timeout(30000);
  const counselor = new mongoose.Types.ObjectId();
  const patient = new mongoose.Types.ObjectId();
  const request = (key, patientId = patient) => ({ user: { _id: patientId }, body: { counselorId: String(counselor), date: new Date(Date.now() + 86400000).toISOString(), requestId: key } });
  before(async () => {
    mongoose.set('autoIndex', false);
    await mongoose.connect(process.env.MONGO_URI);
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    sinon.stub(User, 'findOne').returns({ select: async () => ({ _id: counselor }) });
    sinon.stub(User, 'findById').returns({ select: () => ({ lean: async () => null }) });
  });
  afterEach(() => sinon.restore());
  after(async () => { await mongoose.disconnect(); });
  it('initializes a fresh production collection before booking and reuses the request key', async () => {
    const req = request('production-retry-001');
    const first = response(); await book(req, first);
    expect(first.statusCode).to.equal(201);
    expect(bookingIndexesReady(await Appointment.collection.indexes())).to.equal(true);
    const retry = response(); await book(req, retry);
    expect(retry.statusCode).to.equal(200);
    expect(String(retry.body._id)).to.equal(String(first.body._id));
    expect(await Appointment.countDocuments()).to.equal(1);
    expect(first.body.paymentMode).to.equal('free');
  });
  it('initializes once for simultaneous bookings and rejects the competing patient', async () => {
    const a = request('concurrent-patient-001');
    const b = request('concurrent-patient-002', new mongoose.Types.ObjectId());
    b.body.date = a.body.date;
    const responses = [response(), response()];
    await Promise.all([book(a, responses[0]), book(b, responses[1])]);
    expect(responses.map(r => r.statusCode).sort()).to.deep.equal([201, 409]);
    expect(await Appointment.countDocuments()).to.equal(1);
  });
  it('preserves duplicate records and blocks rather than dropping data', async () => {
    const slot = { patient, counselor, date: new Date(Date.now() + 86400000), status: 'pending' };
    await Appointment.collection.insertMany([{ ...slot }, { ...slot }]);
    const result = response(); await book(request('duplicate-setup-001'), result);
    expect(result.statusCode).to.equal(503);
    expect(result.body.code).to.equal('BOOKING_SETUP_REQUIRED');
    expect(await Appointment.countDocuments()).to.equal(2);
  });
  it('rechecks dropped indexes and supports canonical predicates during preflight', async () => {
    await ensureBookingIndexes(Appointment.collection);
    await Appointment.collection.dropIndex('booking_request_key');
    const plan = await inspectBookingMigration(mongoose.connection.db);
    expect(plan.ready).to.equal(true); // Free booking needs no replica-set transaction.
    expect(plan.plannedIndexes).to.deep.equal(['booking_request_key']);
    await ensureBookingIndexes(Appointment.collection);
    expect(bookingIndexesReady(await Appointment.collection.indexes())).to.equal(true);
  });
  it('preserves conflicting index definitions and recovers after a transient inspection failure', async () => {
    await Appointment.collection.createIndex({ counselor: 1, date: 1 }, { name: 'active_counselor_start' });
    const result = response(); await book(request('conflicting-index-001'), result);
    expect(result.statusCode).to.equal(503);
    expect(await Appointment.countDocuments()).to.equal(0);
    expect((await Appointment.collection.indexes()).find(i => i.name === 'active_counselor_start').unique).not.to.equal(true);
    await Appointment.collection.dropIndex('active_counselor_start');
    const stub = sinon.stub(Appointment.collection, 'indexes').rejects(new Error('temporary database error'));
    try { await ensureBookingIndexes(Appointment.collection); } catch (error) { expect(error.message).to.equal('temporary database error'); }
    stub.restore();
    await ensureBookingIndexes(Appointment.collection);
    expect(bookingIndexesReady(await Appointment.collection.indexes())).to.equal(true);
  });
});

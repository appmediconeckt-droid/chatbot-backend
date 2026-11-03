import { expect } from "chai";
import mongoose from "mongoose";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { inspectBookingMigration, applyBookingMigration, rollbackBookingMigration } from "../src/migrations/bookingIndexes.js";
import { REQUIRED_BOOKING_INDEXES, bookingIndexesReady } from "../src/services/appointmentIndexes.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import AccountDeletionJob from "../src/models/AccountDeletionJob.js";
import AIConsent from "../src/models/AIConsent.js";
import PrivateAsset from "../src/models/PrivateAsset.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import { processAccountDeletionJob } from "../src/services/accountDeletionService.js";
import { deletionRequestAuth } from "../src/middleware/deletionRequestAuth.js";
import { deleteUser } from "../src/controllers/authController.js";
import { authenticateToken } from "../src/middleware/auth.js";
import { storePrivateAsset, canReadPrivateAsset } from "../src/services/privateAssets.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const local = process.env.AUDIT_ISOLATED_ENV === "true" && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI || "");
(local ? describe : describe.skip)("Release gates (disposable local database only)", function () {
  this.timeout(30000);
  let db, appointments;
  before(async () => { await mongoose.connect(process.env.MONGO_URI); db = mongoose.connection.db; });
  afterEach(() => sinon.restore());
  after(async () => mongoose.disconnect());
  beforeEach(async () => {
    // This URI is supplied only by the disposable-database audit runner.
    await db.dropDatabase();
    appointments = db.collection("appointments");
    await db.createCollection("appointments");
  });
  const slot = (overrides = {}) => ({ patient: new ObjectId(), counselor: new ObjectId(), date: new Date(Date.now() + 86400000), status: "pending", ...overrides });
  it("dry-run detects conflicts without repairing data or creating indexes", async () => {
    const a = slot(); await appointments.insertMany([a, { ...a, _id: new ObjectId() }]);
    const before = await appointments.find().toArray();
    const plan = await inspectBookingMigration(db);
    expect(plan.ready).to.equal(false); expect(plan.duplicates.counselorStarts).to.equal(1); expect(plan.duplicates.patientStarts).to.equal(1);
    expect(await appointments.find().toArray()).to.deep.equal(before);
    expect((await appointments.indexes()).map(index => index.name)).to.deep.equal(["_id_"]);
    expect((await applyBookingMigration(db, { writesPaused: true })).status).to.equal("blocked");
  });
  it("preflight catches duplicate idempotency keys, malformed active records and legacy status casing", async () => {
    const patient = new ObjectId();
    await appointments.insertMany([slot({ patient, requestKey: "same-key", status: "canceled" }), slot({ patient, requestKey: "same-key", status: "rejected" }), slot({ date: "bad-date" }), slot({ status: "PENDING" })]);
    const plan = await inspectBookingMigration(db);
    expect(plan.duplicates.requestKeys).to.equal(1); expect(plan.malformedActive).to.equal(1); expect(plan.noncanonicalActive).to.equal(1);
    expect(plan.blockers).to.include.members(["DUPLICATE_RESOLUTION_APPROVAL_REQUIRED", "ACTIVE_RECORD_REPAIR_APPROVAL_REQUIRED", "STATUS_NORMALIZATION_APPROVAL_REQUIRED"]);
  });
  it("a conflicting existing index blocks apply and is never replaced", async () => {
    await appointments.createIndex({ counselor: 1, date: 1 }, { name: "active_counselor_start" });
    const result = await applyBookingMigration(db, { writesPaused: true });
    expect(result.status).to.equal("blocked"); expect(result.plan.blockers).to.include("INDEX_DEFINITION_CONFLICT:active_counselor_start");
    expect((await appointments.indexes()).find(index => index.name === "active_counselor_start").unique).not.to.equal(true);
  });
  it("apply is idempotent, preserves records and enforces exact-start uniqueness", async () => {
    const first = slot(); await appointments.insertOne(first);
    const journals = [];
    const result = await applyBookingMigration(db, { writesPaused: true, saveJournal: async journal => { journals.push(journal); } });
    expect(result.status).to.equal("verified"); expect(journals[0].status).to.equal("prepared"); expect(journals[0].createdIndexes).to.have.length(0);
    expect(bookingIndexesReady(await appointments.indexes())).to.equal(true);
    expect((await applyBookingMigration(db, { writesPaused: true })).journal.createdIndexes).to.have.length(0);
    let duplicate; try { await appointments.insertOne({ ...first, _id: new ObjectId(), patient: new ObjectId() }); } catch (error) { duplicate = error; }
    expect(duplicate.code).to.equal(11000); expect(await appointments.countDocuments()).to.equal(1);
    await appointments.insertOne(slot({ counselor: first.counselor, date: first.date, status: "canceled" }));
    expect(await appointments.countDocuments()).to.equal(2);
  });
  it("apply and rollback require paused writes; rollback preserves pre-existing indexes and data", async () => {
    const { key, ...options } = REQUIRED_BOOKING_INDEXES[0]; await appointments.createIndex(key, options);
    const original = slot(); await appointments.insertOne(original);
    let blocked; try { await applyBookingMigration(db); } catch (error) { blocked = error; } expect(blocked.message).to.contain("paused");
    const { journal } = await applyBookingMigration(db, { writesPaused: true });
    const result = await rollbackBookingMigration(db, journal, { writesPaused: true });
    expect(result.dropped).to.have.length(2);
    expect((await appointments.indexes()).map(index => index.name)).to.include("active_counselor_start");
    expect(await appointments.findOne({ _id: original._id })).to.deep.equal(original);
    expect((await rollbackBookingMigration(db, journal, { writesPaused: true })).dropped).to.have.length(0);
  });
  it("an interrupted build retains a recoverable journal and rollback removes only its new constraints", async () => {
    const create = appointments.createIndex.bind(appointments);
    const actual = db.collection.bind(db); let calls = 0; let journal;
    const wrapper = Object.create(appointments);
    wrapper.createIndex = async (...args) => { calls += 1; if (calls === 2) throw new Error("synthetic index failure"); return create(...args); };
    sinon.stub(db, "collection").callsFake(name => name === "appointments" ? wrapper : actual(name));
    let error; try { await applyBookingMigration(db, { writesPaused: true, saveJournal: async value => { journal = value; } }); } catch (caught) { error = caught; }
    expect(error.message).to.equal("synthetic index failure"); expect(journal.status).to.equal("interrupted"); expect(journal.createdIndexes).to.have.length(1);
    db.collection.restore();
    expect((await rollbackBookingMigration(db, journal, { writesPaused: true })).dropped).to.have.length(1);
    expect((await applyBookingMigration(db, { writesPaused: true })).status).to.equal("verified");
  });
  it("rollback rejects a different database and unexpected index definitions", async () => {
    const { journal } = await applyBookingMigration(db, { writesPaused: true });
    let mismatch; try { await rollbackBookingMigration(db, { ...journal, databaseName: "other_database" }, { writesPaused: true }); } catch (error) { mismatch = error; }
    expect(mismatch.message).to.contain("context");
    await appointments.dropIndex("booking_request_key"); await appointments.createIndex({ patient: 1, requestKey: 1 }, { name: "booking_request_key" });
    let changed; try { await rollbackBookingMigration(db, journal, { writesPaused: true }); } catch (error) { changed = error; }
    expect(changed.message).to.contain("changed");
  });
  it("the rehearsal CLI refuses remote databases before connecting", () => {
    let failure;
    try { execFileSync(process.execPath, ["scripts/audit/booking-index-migration.mjs", "--dry-run"], { env: { ...process.env, HUMAELI_MIGRATION_LOCAL_URI: "mongodb://production.invalid/nope" }, stdio: "pipe" }); }
    catch (error) { failure = error; }
    expect(failure.status).to.equal(1); expect(String(failure.stderr)).to.contain("remote targets are refused");
  });
  it("a malformed rollback journal is rejected before removing any valid constraint", async () => {
    const { journal } = await applyBookingMigration(db, { writesPaused: true });
    const before = await appointments.indexes();
    let failure;
    try { await rollbackBookingMigration(db, { ...journal, plannedIndexes: ["unknown-index", ...journal.plannedIndexes] }, { writesPaused: true }); } catch (error) { failure = error; }
    expect(failure.message).to.contain("unknown"); expect(await appointments.indexes()).to.deep.equal(before);
  });
  it("the local CLI dry-run/apply/rollback persists its recovery journal and preserves records", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "humaeli-booking-rehearsal-"));
    const journalPath = path.join(folder, "journal.json");
    const env = { ...process.env, HUMAELI_MIGRATION_LOCAL_URI: process.env.MONGO_URI, HUMAELI_BOOKING_WRITES_PAUSED: "true" };
    const run = mode => JSON.parse(execFileSync(process.execPath, ["scripts/audit/booking-index-migration.mjs", mode, journalPath], { env, encoding: "utf8", stdio: "pipe" }));
    try {
      const record = slot(); await appointments.insertOne(record);
      expect(run("--dry-run").plannedIndexes).to.have.length(3);
      expect(run("--apply").status).to.equal("verified");
      expect(JSON.parse(await readFile(journalPath, "utf8")).createdIndexes).to.have.length(3);
      expect(run("--rollback").status).to.equal("rolled_back_writes_still_paused");
      expect(await appointments.findOne({ _id: record._id })).to.deep.equal(record);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it("the read-only private-file inventory returns counts without URLs, content or record writes", async () => {
    const privateUrl = "https://res.cloudinary.com/synthetic-only/raw/upload/v1/sensitive-fixture.pdf";
    const fixture = { _id: new ObjectId(), attachmentUrl: privateUrl, content: "private synthetic content" };
    await db.collection("messages").insertOne(fixture);
    const stdout = execFileSync(process.execPath, ["scripts/audit/inventory-private-attachments.mjs"], { env: { ...process.env, HUMAELI_INVENTORY_MONGO_URI: process.env.MONGO_URI }, encoding: "utf8", stdio: "pipe" });
    const inventory = JSON.parse(stdout);
    expect(inventory.categories.consultationAttachments.cloudinaryPublicUploadURL).to.equal(1);
    expect(inventory.applicationWriteCommands).to.equal(0);
    expect(stdout).not.to.contain(privateUrl); expect(stdout).not.to.contain(fixture.content); expect(stdout).not.to.contain(String(fixture._id));
    expect(await db.collection("messages").findOne({ _id: fixture._id })).to.deep.equal(fixture);
  });

  for (const role of ["user", "counsellor"]) {
    it(`${role}: the real deletion HTTP path never reports completion while retention is unapproved`, async () => {
      await Promise.all([User.createCollection(), Session.createCollection(), AccountDeletionJob.createCollection(), AIConsent.createCollection()]);
      const id = new mongoose.Types.ObjectId();
      await User.collection.insertOne({ _id: id, fullName: "Synthetic account", email: `${id}@example.test`, role, isActive: true, isOnline: true, profileCompleted: true });
      const session = await Session.create({ userId: id, refreshToken: `synthetic-${id}`, isActive: true });
      const token = jwt.sign({ userId: String(id), sessionId: String(session._id), role }, process.env.ACCESS_SECRET, { expiresIn: 600 });
      const clinical = { _id: new ObjectId(), patientId: id, problem: "synthetic clinical record" };
      const financial = { _id: new ObjectId(), userId: id, amount: 10, purpose: "synthetic retention fixture" };
      await db.collection("prescriptions").insertOne(clinical); await db.collection("transactions").insertOne(financial);
      const app = express(); app.use(express.json());
      app.delete("/delete", deletionRequestAuth, deleteUser); app.get("/protected", authenticateToken, (_req, res) => res.json({ ok: true }));
      const auth = req => req.set("Authorization", `Bearer ${token}`);
      const first = await auth(request(app).delete("/delete")).send({ userId: new ObjectId().toString() });
      expect(first.status).to.equal(202); expect(first.body.success).to.equal(false); expect(first.body.requestId).to.equal(String(id));
      expect((await processAccountDeletionJob()).status).to.equal("blocked_retention");
      for (let n = 0; n < 3; n += 1) {
        const retry = await auth(request(app).delete("/delete")); expect(retry.status).to.equal(202); expect(retry.body.status).to.equal("blocked_retention"); expect(retry.body.success).to.equal(false);
      }
      expect((await auth(request(app).get("/protected"))).status).to.equal(401);
      expect(await db.collection("prescriptions").findOne({ _id: clinical._id })).to.deep.equal(clinical);
      expect(await db.collection("transactions").findOne({ _id: financial._id })).to.deep.equal(financial);
      expect(await AccountDeletionJob.countDocuments({ status: "completed" })).to.equal(0);
      const persisted = await AccountDeletionJob.collection.findOne({ _id: id });
      expect(persisted.cleanupTracking).to.include({ retainedRecords: "blocked_policy", legalHolds: "unreviewed", backups: "not_verified", cloudinaryCleanup: "blocked_policy", streamCleanup: "not_verified", appleAuthorization: "not_applicable", aiConsent: "revoked" });
      expect(persisted.cleanupTracking).not.to.have.property("policyApprovalReference");
    });
  }
  it("legacy deletion requests gain durable separate cleanup tracking without assuming holds or backups are cleared", async () => {
    const id = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: id, email: `${id}@example.test`, role: "user", isActive: true });
    await AccountDeletionJob.collection.insertOne({ _id: id, status: "pending", attempts: 0, nextAttemptAt: new Date(0) });
    expect((await processAccountDeletionJob()).status).to.equal("blocked_retention");
    const persisted = await AccountDeletionJob.collection.findOne({ _id: id });
    expect(persisted.cleanupTracking.legalHolds).to.equal("unreviewed");
    expect(persisted.cleanupTracking.backups).to.equal("not_verified");
    expect(persisted.cleanupTracking.aiConsent).to.equal("revoked");
    expect(persisted.blockers).to.include.members(["LEGAL_HOLD_REVIEW_REQUIRED", "BACKUP_CLEANUP_VERIFICATION_REQUIRED", "EXTERNAL_PROVIDER_CLEANUP_VERIFICATION_REQUIRED"]);
  });
  it("synthetic attachment cutover preserves bytes/ownership and refuses stale pointer updates", async () => {
    const owner = new mongoose.Types.ObjectId(), counselor = new mongoose.Types.ObjectId(), outsider = new mongoose.Types.ObjectId();
    await Promise.all([PrivateAsset.createCollection(), Chat.createCollection(), Message.createCollection()]);
    const chat = await Chat.create({ userId: owner, counselorId: counselor, status: "active" });
    const oldUrl = "https://res.cloudinary.com/synthetic-only/raw/upload/legacy-fixture.pdf";
    const message = await Message.create({ chatId: chat._id, senderId: owner, senderRole: "user", content: "synthetic attachment", attachmentUrl: oldUrl });
    const bytes = Buffer.from("%PDF-1.7 synthetic fixture; no real Cloudinary request");
    const stored = await storePrivateAsset({ user: { _id: owner }, uploadChat: chat }, { buffer: bytes, mimetype: "application/pdf", originalname: "fixture.pdf" }, "chat");
    const asset = await PrivateAsset.findById(stored.privateAssetId).select("+data");
    expect(createHash("sha256").update(asset.data).digest("hex")).to.equal(createHash("sha256").update(bytes).digest("hex"));
    const cutover = await Message.updateOne({ _id: message._id, attachmentUrl: oldUrl }, { $set: { attachmentUrl: stored.path } }); expect(cutover.modifiedCount).to.equal(1);
    expect((await Message.updateOne({ _id: message._id, attachmentUrl: oldUrl }, { $set: { attachmentUrl: "/wrong" } })).modifiedCount).to.equal(0);
    expect(await canReadPrivateAsset(asset, { _id: owner, role: "user" })).to.equal(true);
    expect(await canReadPrivateAsset(asset, { _id: counselor, role: "counsellor" })).to.equal(true);
    expect(await canReadPrivateAsset(asset, { _id: outsider, role: "user" })).to.equal(false);
    expect((await Message.findById(message._id)).attachmentUrl).to.equal(stored.path);
    // No rollback to the public URL is attempted: a safe rollout rollback
    // keeps this private pointer and the compatible delivery API available.
  });
});

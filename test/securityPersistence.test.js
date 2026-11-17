import { deleteUser } from "../src/controllers/authController.js";
import { expect } from "chai";
import sinon from "sinon";
import mongoose from "mongoose";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as socketClient } from "socket.io-client";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import AccountDeletionJob from "../src/models/AccountDeletionJob.js";
import AIConsent from "../src/models/AIConsent.js";
import Appointment from "../src/models/appointmentModel.js";
import Transaction from "../src/models/transactionModel.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import PrivateAsset from "../src/models/PrivateAsset.js";
import Prescription from "../src/models/Prescription.js";
import { issuePrescription } from "../src/controllers/prescriptionController.js";
import { resolveProfileAsset } from "../src/services/profileAssetReferences.js";
import { requestAccountDeletion, processAccountDeletionJob, accountDeletionResponse } from "../src/services/accountDeletionService.js";
import deletionNotification from "../src/services/deletionNotification.js";
import { encryptAppleToken } from "../src/services/appleTokenService.js";
import { authenticateToken, authenticateSocket } from "../src/middleware/auth.js";
import { deletionRequestAuth } from "../src/middleware/deletionRequestAuth.js";
import { book, updateStatus } from "../src/controllers/appointmentController.js";
import { authorizeChatUpload, storePrivateAsset, validateUploadContent } from "../src/services/privateAssets.js";
import { uploadChatAttachment } from "../src/middleware/multerConfig.js";
import privateFiles from "../src/routes/privateFiles.js";
import SocketHandler from "../src/socket/socketHandler.js";
import { installSocketSessionValidation } from "../src/services/socketSession.js";
import { getStreamToken } from "../src/controllers/streamController.js";
import { REQUIRED_BOOKING_INDEXES, bookingIndexesReady } from "../src/services/appointmentIndexes.js";
import { safeLegacyFilePath, canReadLegacyFile } from "../src/services/legacyPrivateFiles.js";
import { fileTicketAccount } from "../src/services/privateFileTickets.js";

const response = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const local = process.env.AUDIT_ISOLATED_ENV === "true" && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI || "");

(local ? describe : describe.skip)("Security persistence (disposable local replica set only)", function () {
  this.timeout(30000);
  let patient, consultant, stranger, session, token, app;
  const auth = req => req.set("Authorization", `Bearer ${token}`);
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await Promise.all([User.init(), Session.init(), AccountDeletionJob.init(), AIConsent.init(), Appointment.init(), Transaction.init(), PrivateAsset.init(), Message.init(), Chat.init()]);
  });
  beforeEach(async () => {
    for (const model of Object.values(mongoose.models)) await model.deleteMany({});
    const fixture = role => ({ fullName: "Synthetic fixture", email: `${new mongoose.Types.ObjectId()}@example.test`, password: "fixture", phoneNumber: `+91${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 900 + 100)}`, role, isActive: true, profileCompleted: true, qualification: "Synthetic qualification", experience: 3, location: "Synthetic city", demoPaymentsEnabled: true, locationData: { current: { type: "Point", coordinates: [77, 12] } } });
    [patient, consultant, stranger] = await User.create([fixture("user"), fixture("counsellor"), fixture("user")]);
    session = await Session.create({ userId: patient._id, refreshToken: "synthetic-refresh" });
    token = jwt.sign({ userId: String(patient._id), role: "user", sessionId: String(session._id) }, process.env.ACCESS_SECRET, { expiresIn: 600 });
    app = express(); app.use(express.json());
    app.get("/protected", authenticateToken, (_req, res) => res.json({ ok: true }));
    app.delete("/delete", deletionRequestAuth, deleteUser);
    app.use("/api/private-files", privateFiles);
  });
  afterEach(() => { sinon.restore(); delete process.env.APPLE_CLIENT_SECRET; delete process.env.APPLE_TOKEN_ENCRYPTION_KEY; });
  after(async () => mongoose.disconnect());

  const approveExternalCleanup = async userId => AccountDeletionJob.updateOne({ _id: userId }, { $set: {
    "cleanupTracking.legalHolds": "reviewed", "cleanupTracking.backups": "verified", "cleanupTracking.backupCleanupReceipt": "synthetic-backup",
    "cleanupTracking.cloudinaryCleanup": "not_applicable", "cleanupTracking.streamCleanup": "not_applicable",
    nextAttemptAt: new Date(0),
  } });
  for (const role of ["user", "counsellor"]) {
    it(`${role}: delete endpoint erases live data immediately and retries return the same result`, async () => {
      const user = role === "user" ? patient : consultant;
      const login = role === "user" ? session : await Session.create({ userId: user._id, refreshToken: "consultant-refresh" });
      const accessToken = jwt.sign({ userId: String(user._id), role, sessionId: String(login._id) }, process.env.ACCESS_SECRET, { expiresIn: 600 });
      await Appointment.create({ patient: patient._id, counselor: consultant._id, date: new Date(Date.now() + 86400000) });
      await PrivateAsset.create({ ownerId: user._id, purpose: "certification", name: "synthetic.txt", mimeType: "text/plain", data: Buffer.from("synthetic"), size: 9 });
      await Transaction.create({ userId: user._id, amount: 1 });
      const chat = await Chat.create({ userId: patient._id, counselorId: consultant._id, status: "active" });
      await Message.create({ chatId: chat._id, senderId: patient._id, senderRole: "user", content: "synthetic" });
      const result = await request(app).delete("/delete").set("Authorization", `Bearer ${accessToken}`);
      expect(result.status).to.equal(200);
      expect(result.body).to.include({ success: true, status: "account_deleted", localDataDeleted: true, cleanupPending: true, retentionDays: 0 });
      expect(await User.findById(user._id)).to.equal(null);
      expect(await Session.countDocuments({ userId: user._id })).to.equal(0);
      expect(await Appointment.countDocuments()).to.equal(0);
      expect(await PrivateAsset.countDocuments({ ownerId: user._id })).to.equal(0);
      expect(await Transaction.countDocuments({ userId: user._id })).to.equal(0);
      expect(await Message.countDocuments()).to.equal(0);
      expect(await Chat.countDocuments()).to.equal(0);
      const other = role === "user" ? consultant : patient;
      expect(await User.findById(other._id)).not.to.equal(null);
      expect((await request(app).get("/protected").set("Authorization", `Bearer ${accessToken}`)).status).to.equal(401);
      const retry = await request(app).delete("/delete").set("Authorization", `Bearer ${accessToken}`);
      expect(retry.status).to.equal(200); expect(retry.body.requestId).to.equal(String(user._id));
      const wrongSessionToken = jwt.sign({ userId: String(user._id), role, sessionId: String(new mongoose.Types.ObjectId()) }, process.env.ACCESS_SECRET, { expiresIn: 600 });
      expect((await request(app).delete("/delete").set("Authorization", `Bearer ${wrongSessionToken}`)).status).to.equal(401);
    });
  }
  it("duplicate requests and concurrent workers erase once without a waiting period", async () => {
    await Promise.all(Array.from({ length: 4 }, () => requestAccountDeletion(patient)));
    expect(await AccountDeletionJob.countDocuments({ _id: patient._id })).to.equal(1);
    const results = await Promise.all(Array.from({ length: 4 }, () => processAccountDeletionJob()));
    expect(results.filter(Boolean)).to.have.length(1);
    expect(results.find(Boolean).status).to.equal("account_deleted");
    expect(await User.findById(patient._id)).to.equal(null);
  });
  it("a crash after job creation still blocks access and a worker finishes erasure", async () => {
    const fail = sinon.stub(Session, "updateMany").rejects(new Error("synthetic write failure"));
    try { await requestAccountDeletion(patient); throw new Error("expected failure"); } catch (error) { expect(error.message).to.equal("synthetic write failure"); }
    fail.restore();
    await User.updateOne({ _id: patient._id }, { $set: { isActive: true } });
    expect((await auth(request(app).get("/protected"))).status).to.equal(401);
    expect((await processAccountDeletionJob()).status).to.equal("account_deleted");
    expect(await User.findById(patient._id)).to.equal(null);
  });
  it("legacy 90-day jobs are processed immediately despite a future schedule", async () => {
    await requestAccountDeletion(patient);
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { status: "waiting_retention", policyVersion: "owner-90-days-2026-11-14", retentionUntil: new Date(Date.now() + 90 * 86400000), nextAttemptAt: new Date(Date.now() + 90 * 86400000) } });
    expect((await processAccountDeletionJob()).status).to.equal("account_deleted");
    expect(await User.findById(patient._id)).to.equal(null);
  });
  it("Apple failure remains retryable and is never reported as completed deletion", async () => {
    process.env.APPLE_CLIENT_SECRET = "synthetic-client-secret";
    process.env.APPLE_TOKEN_ENCRYPTION_KEY = "11".repeat(32);
    patient.appleId = "synthetic-apple-id"; patient.appleTokenCiphertext = encryptAppleToken("synthetic-apple-refresh"); await patient.save();
    const provider = sinon.stub(globalThis, "fetch").onFirstCall().rejects(new Error("network unavailable"));
    provider.onSecondCall().resolves(new Response(null, { status: 200 }));
    await requestAccountDeletion(patient);
    expect((await processAccountDeletionJob()).status).to.equal("retry");
    let job = await AccountDeletionJob.findById(patient._id);
    expect(job.lastErrorCode).to.equal("APPLE_UNAVAILABLE");
    expect(accountDeletionResponse(job).statusCode).to.equal(202);
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { nextAttemptAt: new Date(0) } });
    expect((await processAccountDeletionJob()).status).to.equal("account_deleted");
    job = await AccountDeletionJob.findById(patient._id);
    expect(job.appleRevokedAt).to.be.instanceOf(Date);
    expect(await User.findById(patient._id)).to.equal(null);
    expect(provider.secondCall.args[1].body.get("token")).to.equal("synthetic-apple-refresh");
    expect(JSON.stringify(job)).not.to.contain("synthetic-apple-refresh");
  });
  it("transaction failure rolls back erasure and can be retried", async () => {
    await requestAccountDeletion(patient);
    const failure = sinon.stub(User, "deleteOne").rejects(new Error("synthetic purge failure"));
    expect((await processAccountDeletionJob()).status).to.equal("retry");
    expect(await User.findById(patient._id)).not.to.equal(null);
    expect(await Session.findById(session._id)).not.to.equal(null);
    failure.restore();
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { nextAttemptAt: new Date(0) } });
    expect((await processAccountDeletionJob()).status).to.equal("account_deleted");
  });
  it("expired worker leases recover", async () => {
    await requestAccountDeletion(patient);
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { status: "processing", leaseOwner: "crashed", leaseUntil: new Date(0) } });
    expect((await processAccountDeletionJob()).status).to.equal("account_deleted");
  });
  it("external cleanup receipts complete independently after immediate local erasure", async () => {
    const confirmation = sinon.stub(deletionNotification, "send").resolves();
    await requestAccountDeletion(patient);
    expect((await processAccountDeletionJob()).status).to.equal("account_deleted");
    expect(confirmation.called).to.equal(false);
    await approveExternalCleanup(patient._id);
    expect((await processAccountDeletionJob()).status).to.equal("completed");
    expect(confirmation.calledOnceWithExactly(patient.email)).to.equal(true);
    const job = await AccountDeletionJob.findById(patient._id).select("+completionEmail");
    expect(job.completionEmail).to.equal(undefined);
    expect(job.cleanupContext).to.equal(undefined);
  });
  it("confirmation delivery retries do not recreate or re-erase the deleted account", async () => {
    const confirmation = sinon.stub(deletionNotification, "send");
    confirmation.onFirstCall().rejects(new Error("synthetic delivery outage")); confirmation.onSecondCall().resolves();
    await requestAccountDeletion(patient);
    await approveExternalCleanup(patient._id);
    expect((await processAccountDeletionJob()).status).to.equal("retry");
    expect(await User.findById(patient._id)).to.equal(null);
    expect(accountDeletionResponse(await AccountDeletionJob.findById(patient._id)).body.status).to.equal("account_deleted");
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { nextAttemptAt: new Date(0) } });
    expect((await processAccountDeletionJob()).status).to.equal("completed");
    expect(confirmation.callCount).to.equal(2);
  });
  it("a known active legal hold prevents erasure and never claims success", async () => {
    await requestAccountDeletion(patient);
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { "cleanupTracking.legalHolds": "active" } });
    expect((await processAccountDeletionJob()).status).to.equal("blocked_cleanup");
    expect(await User.findById(patient._id)).not.to.equal(null);
    expect(accountDeletionResponse(await AccountDeletionJob.findById(patient._id)).statusCode).to.equal(202);
  });
  const booking = (who, date, key, mode = "free") => ({ user: who, body: { counselorId: String(consultant._id), date, requestId: key, paymentMode: mode, demoAmount: 200 } });
  it("concurrent identical free booking retries commit one appointment without a ledger record", async () => {
    const req = booking(patient, new Date(Date.now() + 86400000).toISOString(), "same-request-001", "demo");
    const responses = Array.from({ length: 6 }, response);
    await Promise.all(responses.map(res => book(req, res)));
    expect(responses.map(res => res.statusCode)).to.satisfy(values => values.every(value => [200, 201].includes(value)));
    expect(new Set(responses.map(res => String(res.body._id))).size).to.equal(1);
    expect(await Appointment.countDocuments()).to.equal(1); expect(await Transaction.countDocuments()).to.equal(0);
    const changed = response(); await book({ ...req, body: { ...req.body, notes: "different" } }, changed);
    expect(changed.statusCode).to.equal(409);
  });
  it("two patients cannot reserve the same consultant start; loser leaves no ledger entry", async () => {
    const date = new Date(Date.now() + 86400000).toISOString();
    const a = response(), b = response();
    await Promise.all([book(booking(patient, date, "patient-request-001", "demo"), a), book(booking(stranger, date, "patient-request-002", "demo"), b)]);
    expect([a.statusCode, b.statusCode].sort()).to.deep.equal([201, 409]);
    expect(await Appointment.countDocuments()).to.equal(1); expect(await Transaction.countDocuments()).to.equal(0);
  });
  it("status transitions use compare-and-set, reject outsiders, and canceled slots can be rebooked", async () => {
    const date = new Date(Date.now() + 86400000).toISOString();
    const created = response(); await book(booking(patient, date, "initial-request-01"), created);
    const outsider = response(); await updateStatus({ user: stranger, params: { id: created.body._id }, body: { status: "canceled" } }, outsider);
    expect(outsider.statusCode).to.equal(403);
    const canceled = response(); await updateStatus({ user: patient, params: { id: created.body._id }, body: { status: "canceled" } }, canceled);
    expect(canceled.statusCode).to.equal(200);
    const rebooked = response(); await book(booking(patient, date, "new-booking-key-02"), rebooked);
    expect(rebooked.statusCode).to.equal(201);
  });
  it("competing status updates cannot both overwrite the same pending state", async () => {
    const appointment = await Appointment.create({ patient: patient._id, counselor: consultant._id, date: new Date(Date.now() + 86400000) });
    let release; const barrier = new Promise(resolve => { release = resolve; }); let reads = 0;
    sinon.stub(Appointment, "findById").callsFake(async () => { reads += 1; if (reads === 2) release(); await barrier; return appointment.toObject(); });
    const a = response(), b = response();
    await Promise.all([updateStatus({ user: consultant, params: { id: appointment._id }, body: { status: "confirmed" } }, a), updateStatus({ user: consultant, params: { id: appointment._id }, body: { status: "rejected" } }, b)]);
    expect([a.statusCode, b.statusCode].sort()).to.deep.equal([200, 409]);
  });
  it("booking fails closed when index verification fails", async () => {
    expect(bookingIndexesReady(REQUIRED_BOOKING_INDEXES.map(index => ({ ...index, unique: false })))).to.equal(false);
    const indexes = sinon.stub(Appointment.collection, "indexes").rejects(new Error("Index inspection unavailable"));
    const res = response(); await book(booking(patient, new Date(Date.now() + 86400000).toISOString(), "unconfigured-key"), res);
    expect(res.statusCode).to.equal(503); expect(await Appointment.countDocuments()).to.equal(0);
    indexes.restore();
  });
  it("third-party mark-read cannot mutate messages; a participant can", async () => {
    const chat = await Chat.create({ userId: patient._id, counselorId: consultant._id, status: "active" });
    const message = await Message.create({ chatId: chat._id, senderId: consultant._id, senderRole: "counsellor", content: "synthetic" });
    const handler = new SocketHandler({ to: () => ({ emit() {} }) });
    await handler.handleMarkRead({ userId: String(stranger._id), userRole: "user" }, { chatId: String(chat._id) });
    expect((await Message.findById(message._id)).isRead).to.equal(false);
    await handler.handleMarkRead({ userId: String(patient._id), userRole: "user" }, { chatId: chat.chatId });
    expect((await Message.findById(message._id)).isRead).to.equal(true);
  });
  it("a connected socket is disconnected before handling its next packet after session revocation", async () => {
    const http = createServer(); const io = new Server(http); let handled = 0;
    io.use(authenticateSocket);
    io.on("connection", socket => { installSocketSessionValidation(socket); socket.on("private-action", () => { handled += 1; }); });
    await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
    const client = socketClient(`http://127.0.0.1:${http.address().port}`, { auth: { token }, transports: ["websocket"], reconnection: false });
    try {
      await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
      client.emit("private-action"); await pause(100); expect(handled).to.equal(1);
      await Session.updateOne({ _id: session._id }, { $set: { isActive: false } });
      const disconnected = new Promise(resolve => client.once("disconnect", resolve));
      client.emit("private-action"); await disconnected;
      expect(handled).to.equal(1);
    } finally { client.disconnect(); await new Promise(resolve => io.close(resolve)); }
  });
  it("idle revoked sockets lose subscriptions without sending another packet", async () => {
    const http = createServer(); const io = new Server(http);
    io.use(authenticateSocket); io.on("connection", installSocketSessionValidation);
    await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
    const client = socketClient(`http://127.0.0.1:${http.address().port}`, { auth: { token }, transports: ["websocket"], reconnection: false });
    try {
      await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
      const disconnected = new Promise(resolve => client.once("disconnect", resolve));
      await Session.updateOne({ _id: session._id }, { $set: { isActive: false } });
      await disconnected; expect(client.connected).to.equal(false);
    } finally { client.disconnect(); await new Promise(resolve => io.close(resolve)); }
  });
  it("private uploads require membership before storage; MIME spoofing is rejected", async () => {
    const chat = await Chat.create({ userId: stranger._id, counselorId: consultant._id, status: "active" });
    app.post("/upload/:chatId", authenticateToken, authorizeChatUpload, uploadChatAttachment, (req, res) => res.json({ path: req.file.path }));
    const denied = await auth(request(app).post(`/upload/${chat._id}`)).attach("attachment", Buffer.from("%PDF-1.7 synthetic"), { filename: "fixture.pdf", contentType: "application/pdf" });
    expect(denied.status).to.equal(403); expect(await PrivateAsset.countDocuments()).to.equal(0);
    expect(() => validateUploadContent({ buffer: Buffer.from("<script>malicious</script>"), mimetype: "image/png" })).to.throw();
    expect(() => validateUploadContent({ buffer: Buffer.from("<svg>malicious</svg>"), mimetype: "text/plain" })).to.throw();
  });
  it("legacy attachments retain participant-only access and reject unsafe paths and expired capabilities", async () => {
    const chat = await Chat.create({ userId: patient._id, counselorId: consultant._id, status: "active" });
    const filePath = "/uploads/certifications/synthetic.pdf";
    await Message.create({ chatId: chat._id, senderId: patient._id, senderRole: "user", content: "fixture", attachmentUrl: `https://api.example.test${filePath}` });
    expect(await canReadLegacyFile(filePath, patient)).to.equal(true);
    expect(await canReadLegacyFile(filePath, stranger)).to.equal(false);
    expect(safeLegacyFilePath("/uploads/a/%2F../private")).to.equal(null);
    expect(safeLegacyFilePath("/uploads/.secret")).to.equal(null);
    const link = await auth(request(app).get("/api/private-files/legacy-link").query({ path: filePath }));
    expect(link.status).to.equal(200); expect(link.body.url).to.match(/ticket=/);
    const ticket = link.body.url.split("ticket=")[1];
    const realNow = Date.now(); const clock = sinon.stub(Date, "now").returns(realNow + 61000);
    try { await fileTicketAccount(ticket, "legacy-private-file"); throw new Error("expected expiry"); }
    catch (error) { expect(error.name).to.equal("TokenExpiredError"); }
    finally { clock.restore(); }

  });
  it("private attachment reads and short download tickets honor participant, deletion and revocation checks", async () => {
    const chat = await Chat.create({ userId: patient._id, counselorId: consultant._id, status: "active" });
    const file = await storePrivateAsset({ user: patient, uploadChat: chat }, { originalname: "fixture.pdf", mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.7 synthetic") }, "chat");
    const message = await Message.create({ chatId: chat._id, senderId: patient._id, senderRole: "user", content: "fixture", attachmentUrl: file.path });
    expect((await request(app).get(file.path)).status).to.equal(401);
    expect((await auth(request(app).get(file.path))).status).to.equal(200);
    const link = await auth(request(app).get(`${file.path}/link`)); expect(link.status).to.equal(200);
    expect((await request(app).get(link.body.url)).status).to.equal(200);
    // A file ticket cannot become an API access token.
    expect((await request(app).get("/protected").set("Authorization", `Bearer ${link.body.url.split("ticket=")[1]}`)).status).to.equal(401);
    await Message.updateOne({ _id: message._id }, { $set: { deletedFor: [patient._id] } });
    expect((await auth(request(app).get(file.path))).status).to.equal(404);
    await Session.updateOne({ _id: session._id }, { $set: { isActive: false } });
    expect((await request(app).get(link.body.url)).status).to.equal(401);
  });
  it("Stream token requests without an accepted participant call fail before provider work", async () => {
    const res = response(); await getStreamToken({ user: patient, query: { callId: "unrelated" } }, res);
    expect(res.statusCode).to.equal(403);
  });
  it("an orphaned chat attachment cannot regain access after its message is removed", async () => {
    const chat = await Chat.create({ userId: patient._id, counselorId: consultant._id, status: "active" });
    const file = await storePrivateAsset({ user: patient, uploadChat: chat }, { originalname: "fixture.pdf", mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.7 synthetic") }, "chat");
    expect((await auth(request(app).get(file.path))).status).to.equal(404);
    const message = await Message.create({ chatId: chat._id, senderId: patient._id, senderRole: "user", content: "fixture", attachmentUrl: file.path });
    expect((await auth(request(app).get(file.path))).status).to.equal(200);
    await Message.deleteOne({ _id: message._id });
    expect((await auth(request(app).get(file.path))).status).to.equal(404);
    expect((await auth(request(app).get(`${file.path}/link`))).status).to.equal(404);
  });
  it("profile asset lookup requires actual database ownership and purpose", async () => {
    const asset = await PrivateAsset.create({ ownerId: consultant._id, purpose: "certification", name: "synthetic.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.7 synthetic"), size: 18 });
    const path = `/api/private-files/${asset._id}`;
    expect(await resolveProfileAsset(path, patient._id, "certification")).to.equal(null);
    expect(await resolveProfileAsset(path, consultant._id, "prescription")).to.equal(null);
    expect((await resolveProfileAsset(path, consultant._id, "certification")).publicId).to.equal(`private:${asset._id}`);
  });
  it("private prescription snapshots preserve patient verification, ownership and session revocation", async () => {
    consultant.specialization = ["Psychiatry"];
    const bytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const source = await PrivateAsset.create({ ownerId: consultant._id, purpose: "prescription", name: "synthetic.png", mimeType: "image/png", data: bytes, size: bytes.length });
    consultant.prescriptionSignature = { url: `/api/private-files/${source._id}`, publicId: `private:${source._id}` };
    await consultant.save();
    const chat = await Chat.create({ userId: patient._id, counselorId: consultant._id, status: "active" });
    const res = response();
    await issuePrescription({ user: consultant, params: { chatId: String(chat._id) }, body: {
      problem: "Synthetic", medicines: [{ name: "Synthetic", dosage: "Synthetic", timing: "Synthetic", timeOfDay: ["Morning"] }],
    }, file: { mimetype: "application/pdf", originalname: "synthetic.pdf", buffer: Buffer.from("%PDF-1.7 synthetic"), size: 18 } }, res);
    expect(res.statusCode).to.equal(201);
    const record = await Prescription.findById(res.body.prescription.id);
    const snapshotPath = record.psychiatristSnapshot.prescriptionSignature;
    expect(snapshotPath).not.to.equal(consultant.prescriptionSignature.url);
    expect((await auth(request(app).get(consultant.prescriptionSignature.url))).status).to.equal(404);
    expect((await auth(request(app).get(snapshotPath))).status).to.equal(404);
    await Prescription.updateOne({ _id: record._id }, { $set: { "identityVerification.status": "verified" } });
    expect((await auth(request(app).get(snapshotPath))).status).to.equal(200);
    const outsiderSession = await Session.create({ userId: stranger._id, refreshToken: "outsider-refresh" });
    const outsiderToken = jwt.sign({ userId: stranger._id, sessionId: outsiderSession._id, role: "user" }, process.env.ACCESS_SECRET, { expiresIn: 600 });
    expect((await request(app).get(snapshotPath).set("Authorization", `Bearer ${outsiderToken}`)).status).to.equal(404);
    await Session.updateOne({ _id: session._id }, { $set: { isActive: false } });
    expect((await auth(request(app).get(snapshotPath))).status).to.equal(401);
  });
});

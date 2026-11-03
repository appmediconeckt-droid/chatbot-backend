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
import { requestAccountDeletion, processAccountDeletionJob } from "../src/services/accountDeletionService.js";
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
    app.delete("/delete", deletionRequestAuth, (_req, res) => res.sendStatus(418));
    app.use("/api/private-files", privateFiles);
  });
  afterEach(() => { sinon.restore(); delete process.env.APPLE_CLIENT_SECRET; delete process.env.APPLE_TOKEN_ENCRYPTION_KEY; });
  after(async () => mongoose.disconnect());

  for (const role of ["user", "counsellor"]) {
    it(`${role}: duplicate deletion requests create one job, revoke access, preserve records and stop at retention hold`, async () => {
      const user = role === "user" ? patient : consultant;
      await Appointment.create({ patient: patient._id, counselor: consultant._id, date: new Date(Date.now() + 86400000) });
      await Promise.all(Array.from({ length: 4 }, () => requestAccountDeletion(user)));
      expect(await AccountDeletionJob.countDocuments({ _id: user._id })).to.equal(1);
      expect((await User.findById(user._id)).isActive).to.equal(false);
      if (role === "user") {
        expect((await auth(request(app).get("/protected"))).status).to.equal(401);
        const retry = await auth(request(app).delete("/delete"));
        expect(retry.status).to.equal(202); expect(retry.body.success).to.equal(false);
        expect(retry.body.requestId).to.equal(String(user._id));
      }
      expect((await processAccountDeletionJob()).status).to.equal("blocked_retention");
      expect(await processAccountDeletionJob()).to.equal(null);
      expect(await Appointment.countDocuments()).to.equal(1);
      expect(await User.findById(user._id)).not.to.equal(null);
      expect((await AccountDeletionJob.findById(user._id)).blockers).to.include("RETENTION_POLICY_APPROVAL_REQUIRED");
    });
  }
  it("a crash after job creation still blocks access; a later worker repairs session revocation", async () => {
    const fail = sinon.stub(Session, "updateMany").rejects(new Error("synthetic write failure"));
    try { await requestAccountDeletion(patient); throw new Error("expected failure"); } catch (error) { expect(error.message).to.equal("synthetic write failure"); }
    fail.restore();
    // Model a crash before the account flag write as well.
    await User.updateOne({ _id: patient._id }, { $set: { isActive: true } });
    expect((await auth(request(app).get("/protected"))).status).to.equal(401);
    expect((await processAccountDeletionJob()).status).to.equal("blocked_retention");
    expect((await Session.findById(session._id)).isActive).to.equal(false);
  });
  it("Apple network failure is durable and retryable; success is checkpointed without deleting records", async () => {
    process.env.APPLE_CLIENT_SECRET = "synthetic-client-secret";
    process.env.APPLE_TOKEN_ENCRYPTION_KEY = "11".repeat(32);
    patient.appleId = "synthetic-apple-id";
    patient.appleTokenCiphertext = encryptAppleToken("synthetic-apple-refresh");
    await patient.save();
    const provider = sinon.stub(globalThis, "fetch").onFirstCall().rejects(new Error("network unavailable"));
    provider.onSecondCall().resolves(new Response(null, { status: 200 }));
    await requestAccountDeletion(patient);
    expect((await processAccountDeletionJob()).status).to.equal("retry");
    let job = await AccountDeletionJob.findById(patient._id);
    expect(job.lastErrorCode).to.equal("APPLE_UNAVAILABLE"); expect(job.appleRevokedAt).to.equal(undefined);
    expect(await processAccountDeletionJob()).to.equal(null);
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { nextAttemptAt: new Date(0) } });
    expect((await processAccountDeletionJob()).status).to.equal("blocked_retention");
    job = await AccountDeletionJob.findById(patient._id);
    expect(job.appleRevokedAt).to.be.instanceOf(Date);
    expect(provider.secondCall.args[1].body.get("token")).to.equal("synthetic-apple-refresh");
    expect(JSON.stringify(job)).not.to.contain("synthetic-apple-refresh");
  });
  it("expired worker leases recover and competing workers claim a job only once", async () => {
    await requestAccountDeletion(patient);
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { status: "processing", leaseOwner: "crashed", leaseUntil: new Date(0) } });
    const results = await Promise.all(Array.from({ length: 4 }, () => processAccountDeletionJob()));
    expect(results.filter(Boolean)).to.have.length(1);
    expect((await AccountDeletionJob.findById(patient._id)).attempts).to.equal(1);
  });
  it("a later cleanup failure preserves the Apple checkpoint and retries the remaining effect only", async () => {
    process.env.APPLE_CLIENT_SECRET = "synthetic-client-secret";
    process.env.APPLE_TOKEN_ENCRYPTION_KEY = "11".repeat(32);
    patient.appleId = "synthetic-apple-id"; patient.appleTokenCiphertext = encryptAppleToken("synthetic-refresh"); await patient.save();
    await AIConsent.create({ userId: patient._id, provider: "OpenAI", activeCalls: ["synthetic-call"] });
    const provider = sinon.stub(globalThis, "fetch");
    provider.onFirstCall().resolves(new Response(null, { status: 200 }));
    provider.onSecondCall().resolves(new Response(null, { status: 503 }));
    provider.onThirdCall().resolves(new Response(null, { status: 200 }));
    await requestAccountDeletion(patient);
    expect((await processAccountDeletionJob()).status).to.equal("retry");
    expect((await AccountDeletionJob.findById(patient._id)).appleRevokedAt).to.be.instanceOf(Date);
    await AccountDeletionJob.updateOne({ _id: patient._id }, { $set: { nextAttemptAt: new Date(0) } });
    expect((await processAccountDeletionJob()).status).to.equal("blocked_retention");
    expect(provider.getCalls().filter(call => call.args[0].includes("appleid.apple.com"))).to.have.length(1);
    expect((await AIConsent.findOne({ userId: patient._id })).activeCalls).to.have.length(0);
  });
  const booking = (who, date, key, mode = "free") => ({ user: who, body: { counselorId: String(consultant._id), date, requestId: key, paymentMode: mode, demoAmount: 200 } });
  it("concurrent identical booking retries commit one appointment and one simulation ledger record", async () => {
    const req = booking(patient, new Date(Date.now() + 86400000).toISOString(), "same-request-001", "demo");
    const responses = Array.from({ length: 6 }, response);
    await Promise.all(responses.map(res => book(req, res)));
    expect(responses.map(res => res.statusCode)).to.satisfy(values => values.every(value => [200, 201].includes(value)));
    expect(new Set(responses.map(res => String(res.body._id))).size).to.equal(1);
    expect(await Appointment.countDocuments()).to.equal(1); expect(await Transaction.countDocuments()).to.equal(1);
    const changed = response(); await book({ ...req, body: { ...req.body, notes: "different" } }, changed);
    expect(changed.statusCode).to.equal(409);
  });
  it("two patients cannot reserve the same consultant start; loser leaves no ledger entry", async () => {
    const date = new Date(Date.now() + 86400000).toISOString();
    const a = response(), b = response();
    await Promise.all([book(booking(patient, date, "patient-request-001", "demo"), a), book(booking(stranger, date, "patient-request-002", "demo"), b)]);
    expect([a.statusCode, b.statusCode].sort()).to.deep.equal([201, 409]);
    expect(await Appointment.countDocuments()).to.equal(1); expect(await Transaction.countDocuments()).to.equal(1);
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
  it("booking fails closed if a required index is absent or is not unique", async () => {
    expect(bookingIndexesReady(REQUIRED_BOOKING_INDEXES.map(index => ({ ...index, unique: false })))).to.equal(false);
    const indexes = sinon.stub(Appointment.collection, "indexes").resolves([]);
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
});

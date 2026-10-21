import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import User from "../src/models/userModel.js";
import UserBlock from "../src/models/UserBlock.js";
import AbuseReport from "../src/models/AbuseReport.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import Session from "../src/models/sessionModel.js";
import safetyRoutes from "../src/routes/chatSafetyRoutes.js";
import {
  interactionIsBlocked,
  requireUnblockedInteraction,
} from "../src/services/interactionSafety.js";
const A = "100000000000000000000001",
  B = "100000000000000000000002",
  C = "100000000000000000000003",
  sid = "200000000000000000000001";
describe("Conversation safety", () => {
  let app;
  const token = (id = A, role = "user") =>
    jwt.sign({ userId: role === "admin" ? "100000000000000000000004" : id, sessionId: sid, role }, process.env.ACCESS_SECRET);
  beforeEach(() => {
    sinon.stub(User, "findById").callsFake(async id => ({ _id: id, role: String(id) === "100000000000000000000004" ? "admin" : "user", isActive: true }));
    sinon.stub(Session, "findOne").resolves({ isActive: true });
    sinon
      .stub(Chat, "findOne")
      .resolves({ _id: C, chatId: "demo-chat", userId: A, counselorId: B });
    app = express();
    app.use(express.json());
    app.use(safetyRoutes);
  });
  afterEach(() => sinon.restore());
  it("lets only an admin hide content from the reported conversation", async () => {
    sinon
      .stub(AbuseReport, "findById")
      .returns({
        lean: async () => ({ _id: C, chatId: C, reporterId: A, reportedId: B }),
      });
    const update = sinon
      .stub(Message, "findOneAndUpdate")
      .resolves({ _id: C, messageId: "message-test" });
    await request(app)
      .patch(`/moderation/reports/${C}/messages/${C}`)
      .set("Authorization", `Bearer ${token(A, "admin")}`)
      .send({ hidden: true })
      .expect(200);
    expect(update.firstCall.args[0]).to.deep.equal({ _id: C, chatId: C });
    expect(update.firstCall.args[1]).to.deep.equal({
      $set: { moderationHidden: true },
    });
  });
  it("denies normal accounts access to report context or moderation actions", async () => {
    await request(app)
      .get(`/moderation/reports/${C}`)
      .set("Authorization", `Bearer ${token()}`)
      .expect(403);
    await request(app)
      .patch(`/moderation/reports/${C}/messages/${C}`)
      .set("Authorization", `Bearer ${token()}`)
      .send({ hidden: true })
      .expect(403);
  });
  it("checks blocks in both directions", async () => {
    const find = sinon.stub(UserBlock, "exists").resolves({ _id: C });
    expect(await interactionIsBlocked(A, B)).to.equal(true);
    expect(find.firstCall.args[0].$or).to.deep.equal([
      { blockerId: A, blockedId: B },
      { blockerId: B, blockedId: A },
    ]);
  });
  it("denies reports and blocks from an unrelated account", async () => {
    const create = sinon.stub(AbuseReport, "create");
    await request(app)
      .post("/safety/demo-chat/report")
      .set("Authorization", `Bearer ${token(C)}`)
      .send({ reason: "harassment" })
      .expect(403);
    await request(app)
      .put("/safety/demo-chat/block")
      .set("Authorization", `Bearer ${token(C)}`)
      .send({ blocked: true })
      .expect(403);
    expect(create.called).to.equal(false);
  });
  it("saves a report with server-derived identities and rejects invalid reasons", async () => {
    sinon.stub(AbuseReport, "countDocuments").resolves(0);
    const create = sinon.stub(AbuseReport, "create").resolves({ _id: C });
    await request(app)
      .post("/safety/demo-chat/report")
      .set("Authorization", `Bearer ${token()}`)
      .send({ reason: "harassment", reporterId: B, reportedId: C })
      .expect(201);
    expect(create.firstCall.args[0]).to.include({
      reporterId: A,
      reportedId: B,
      chatId: C,
    });
    await request(app)
      .post("/safety/demo-chat/report")
      .set("Authorization", `Bearer ${token()}`)
      .send({ reason: "unknown" })
      .expect(400);
  });
  it("only changes the caller's own block", async () => {
    const update = sinon.stub(UserBlock, "updateOne").resolves({});
    await request(app)
      .put("/safety/demo-chat/block")
      .set("Authorization", `Bearer ${token()}`)
      .send({ blocked: true, blockerId: B })
      .expect(200);
    expect(update.firstCall.args[0]).to.deep.equal({
      blockerId: A,
      blockedId: B,
    });
  });
  it("prevents blocked chat and call actions before the handler runs", async () => {
    sinon.stub(UserBlock, "exists").resolves({ _id: C });
    const next = sinon.spy();
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await requireUnblockedInteraction(
      { user: { _id: A }, params: {}, body: { receiverId: B } },
      res,
      next
    );
    expect(res.status.calledWith(403)).to.equal(true);
    expect(next.called).to.equal(false);
  });
  it("restricts moderation reports to admins", async () => {
    await request(app)
      .get("/moderation/reports")
      .set("Authorization", `Bearer ${token()}`)
      .expect(403);
  });
  it("fails closed when block storage is unavailable", async () => {
    sinon.stub(UserBlock, "exists").rejects(new Error("DB unavailable"));
    const next = sinon.spy();
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await requireUnblockedInteraction(
      { user: { _id: A }, params: {}, body: { receiverId: B } },
      res,
      next
    );
    expect(res.status.calledWith(503)).to.equal(true);
    expect(next.called).to.equal(false);
  });
});

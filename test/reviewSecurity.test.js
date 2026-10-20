import { expect } from "chai";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import express from "express";
import request from "supertest";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import {
  refreshAccessToken,
  getUser,
} from "../src/controllers/authController.js";
import { authenticateToken, authorizeRoles } from "../src/middleware/auth.js";
import { publicCounselorProfile } from "../src/utils/publicProfile.js";
import videoRoutes from "../src/routes/videoRoutes.js";
import Call from "../src/models/Call.js";
import { getRecentCalls } from "../src/controllers/callController.js";
import { videoCallController } from "../src/controllers/videoCallController.js";

describe("App review account security", () => {
  afterEach(() => sinon.restore());
  it("keeps patient identity and precise location out of legacy call history", async () => {
    const callerId = new mongoose.Types.ObjectId(),
      receiverId = new mongoose.Types.ObjectId();
    sinon
      .stub(Call, "find")
      .returns({
        sort: () => ({
          limit: async () => [
            {
              callerId,
              receiverId,
              initiatorType: "user",
              receiverType: "counsellor",
              callerName: "Private Patient",
              callerAvatar: "private-photo",
              callerLocation: "Private address",
              callerLocationData: { coordinates: [1, 2] },
            },
          ],
        }),
      });
    let body;
    await getRecentCalls(
      { query: {}, user: { _id: receiverId, role: "counsellor" } },
      {
        json: (value) => {
          body = value;
        },
        status() {
          return this;
        },
      }
    );
    expect(body.calls[0].otherParty).to.include({
      name: "Anonymous User",
      avatar: null,
      location: null,
      locationData: null,
    });
  });
  it("uses anonymous identity when preparing patient video-call context", async () => {
    const id = new mongoose.Types.ObjectId();
    sinon
      .stub(User, "findById")
      .returns({
        select: async () => ({
          _id: id,
          role: "user",
          isActive: true,
          fullName: "Private Patient",
          anonymous: "CalmRiver",
          email: "private@example.com",
          profilePhoto: { url: "private-photo" },
          location: "Private address",
        }),
      });
    const details = await videoCallController.getUserDetails(
      String(id),
      "user"
    );
    expect(details).to.include({
      fullName: "CalmRiver",
      name: "CalmRiver",
      email: "",
      profilePhoto: null,
      location: "",
    });
  });
  for (const role of ["user", "counsellor"]) {
    it(`preserves ${role} access to protected routes after refresh`, async () => {
      const userId = new mongoose.Types.ObjectId();
      const sessionId = new mongoose.Types.ObjectId();
      const incoming = jwt.sign(
        { userId, sessionId, role },
        process.env.REFRESH_SECRET
      );
      const session = {
        _id: sessionId,
        userId,
        refreshToken: incoming,
        isActive: true,
        save: sinon.stub().resolves(),
      };
      sinon.stub(Session, "findById").resolves(session);
      sinon.stub(Session, "findOne").resolves(session);
      sinon
        .stub(User, "findById")
        .resolves({ _id: userId, role, isActive: true });
      sinon.stub(User, "findByIdAndUpdate").resolves({});
      let body;
      const cookies = [];
      await refreshAccessToken(
        { body: { refreshToken: incoming }, cookies: {} },
        {
          cookie(name, value, options) {
            cookies.push({ name, options });
          },
          json(value) {
            body = value;
          },
          status() {
            return this;
          },
        }
      );
      expect(
        jwt.verify(body.accessToken, process.env.ACCESS_SECRET).role
      ).to.equal(role);
      expect(cookies).to.have.length(2);
      for (const cookie of cookies) {
        expect(cookie.options.httpOnly).to.equal(true);
        expect(cookie.options.secure).to.equal(
          process.env.NODE_ENV === "production"
        );
      }
      const app = express();
      app.get(
        "/protected",
        authenticateToken,
        authorizeRoles(role),
        (_req, res) => res.sendStatus(200)
      );
      await request(app)
        .get("/protected")
        .set("Authorization", `Bearer ${body.accessToken}`)
        .expect(200);
    });
  }
  it("removes private fields from public professional profiles", () => {
    const profile = publicCounselorProfile({
      _id: "123",
      role: "counsellor",
      fullName: "Test",
      specialization: ["Wellness"],
      email: "private@example.com",
      phoneNumber: "123",
      googleId: "secret",
      locationData: { history: [] },
      bankDetails: {},
      emailOTP: { code: "111111" },
      password: "hash",
      refreshToken: "secret",
    });
    expect(profile).to.deep.equal({
      _id: "123",
      fullName: "Test",
      role: "counsellor",
      specialization: ["Wellness"],
    });
  });
  it("denies unrelated accounts access to a patient's profile", async () => {
    const id = new mongoose.Types.ObjectId();
    sinon.stub(User, "findById").resolves({ _id: id, role: "user" });
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await getUser(
      {
        params: { userId: String(id) },
        user: { _id: new mongoose.Types.ObjectId(), role: "user" },
      },
      res
    );
    expect(res.status.calledWith(403)).to.equal(true);
  });
  it("requires authentication on legacy call history, details, and status endpoints", async () => {
    const app = express();
    app.use(express.json());
    app.use("/video", videoRoutes);
    for (const path of [
      "/calls/history/test",
      "/calls/active/test",
      "/calls/test/details",
      "/calls/all",
    ])
      await request(app).get(`/video${path}`).expect(401);
    await request(app)
      .put("/video/users/status")
      .send({ userId: "other", status: "offline" })
      .expect(401);
  });
});

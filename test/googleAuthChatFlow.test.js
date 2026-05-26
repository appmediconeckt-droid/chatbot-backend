// Integration test: brand-new user signs up via Google → sends chat request
// → existing counsellor accepts within 30s. Verifies the full flow that the
// user originally reported as broken.
//
// We don't have a real Google idToken so we stub OAuth2Client.prototype
// .verifyIdToken to return a synthetic payload. Everything else (DB writes,
// session creation, controller behavior) runs for real against the .env DB.

import { expect } from "chai";
import mongoose from "mongoose";
import sinon from "sinon";
import dotenv from "dotenv";
import dns from "dns";
import { OAuth2Client } from "google-auth-library";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
dotenv.config();

import connectDB from "../src/config/db.js";
import User from "../src/models/userModel.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import Session from "../src/models/sessionModel.js";
import { googleAuth } from "../src/controllers/authController.js";
import {
  startChat,
  acceptChat,
} from "../src/controllers/messageController.js";

const TEST_TAG = "__googleAuthChatTest__";

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.cookies = {};
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.json = function (payload) {
    this.body = payload;
    return this;
  };
  res.cookie = function (name, value, opts) {
    this.cookies[name] = { value, opts };
    return this;
  };
  return res;
}

describe("Google auth → chat request → counsellor accept (30s window)", function () {
  this.timeout(30000);

  let verifyStub;
  let counsellor;
  let uniq;

  before(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    uniq = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

    // Pre-existing counsellor the new user will message. Marked as
    // google-signup so the counsellor-only required fields aren't enforced.
    counsellor = await User.create({
      fullName: `${TEST_TAG} counsellor ${uniq}`,
      email: `test-counsellor-${uniq}@gchatflow.test`,
      googleId: `gid-counsellor-${uniq}`,
      authProvider: "google",
      role: "counsellor",
      isActive: true,
      locationData: {
        current: { type: "Point", coordinates: [77.5946, 12.9716] },
      },
    });

    // Stub Google's token verification so we don't need a real idToken.
    verifyStub = sinon.stub(OAuth2Client.prototype, "verifyIdToken");
  });

  afterEach(async () => {
    if (verifyStub) verifyStub.restore();

    // Clean up everything tagged by this test
    const taggedUsers = await User.find({
      fullName: { $regex: TEST_TAG },
    }).select("_id");
    const ids = taggedUsers.map((u) => u._id);
    if (ids.length) {
      const chats = await Chat.find({
        $or: [{ userId: { $in: ids } }, { counselorId: { $in: ids } }],
      }).select("_id");
      const chatIds = chats.map((c) => c._id);
      if (chatIds.length) await Message.deleteMany({ chatId: { $in: chatIds } });
      await Chat.deleteMany({ _id: { $in: chatIds } });
      await Session.deleteMany({ userId: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
  });

  after(async () => {
    await mongoose.disconnect();
  });

  it("new Google user signs up, sends chat request, counsellor accepts — full flow works", async () => {
    const googleEmail = `gtest-${uniq}@gchatflow.test`;
    const googleSub = `gsub-${uniq}`;

    // Step 1: Google verifies the idToken and returns the user's profile.
    verifyStub.resolves({
      getPayload: () => ({
        email: googleEmail,
        email_verified: true,
        sub: googleSub,
        name: `${TEST_TAG} newuser ${uniq}`,
        picture: "https://example.test/avatar.png",
      }),
    });

    // Step 2: User hits POST /api/auth/google with role=user
    const authReq = {
      body: { idToken: "fake-google-id-token", role: "user" },
      headers: {},
    };
    const authRes = makeRes();
    await googleAuth(authReq, authRes);

    expect(authRes.statusCode, "google auth status").to.equal(200);
    expect(authRes.body).to.have.property("success", true);
    expect(authRes.body).to.have.property("isNewUser", true);
    expect(authRes.body).to.have.property("accessToken").that.is.a("string");
    expect(authRes.body.user).to.have.property("email", googleEmail);
    expect(authRes.body.user).to.have.property("role", "user");

    const newUserId = authRes.body.user._id || authRes.body.user.id;
    expect(newUserId, "new user id present").to.exist;

    // Verify the user actually exists in DB with googleId set
    const persistedUser = await User.findById(newUserId);
    expect(persistedUser).to.exist;
    expect(persistedUser.googleId).to.equal(googleSub);
    expect(persistedUser.authProvider).to.equal("google");

    // Step 3: New user sends chat request to the counsellor
    const startReq = {
      user: { _id: persistedUser._id, role: "user" },
      body: { counselorId: counsellor._id },
    };
    const startRes = makeRes();
    await startChat(startReq, startRes);

    expect(startRes.statusCode, "start chat status").to.equal(200);
    expect(startRes.body).to.have.property("success", true);
    expect(startRes.body.chat).to.have.property("expiresAt");

    const expiresAt = new Date(startRes.body.chat.expiresAt).getTime();
    const deltaSec = (expiresAt - Date.now()) / 1000;
    expect(deltaSec, "expiry ~30s away").to.be.greaterThan(25).and.lessThan(35);

    const chatId = startRes.body.chat.id;

    // Step 4: Counsellor accepts the request
    const acceptReq = {
      user: { _id: counsellor._id, role: "counsellor" },
      params: { chatId: String(chatId) },
    };
    const acceptRes = makeRes();
    await acceptChat(acceptReq, acceptRes);

    expect(acceptRes.statusCode, "accept status").to.equal(200);
    expect(acceptRes.body).to.have.property("success", true);
    expect(acceptRes.body.chat).to.have.property("status", "accepted");
    expect(acceptRes.body.chat.user.id.toString()).to.equal(
      persistedUser._id.toString(),
    );
  });

  it("returning Google user (second login) reuses existing account, not creates duplicate", async () => {
    const googleEmail = `greturning-${uniq}@gchatflow.test`;
    const googleSub = `gsub-returning-${uniq}`;

    verifyStub.resolves({
      getPayload: () => ({
        email: googleEmail,
        email_verified: true,
        sub: googleSub,
        name: `${TEST_TAG} returning ${uniq}`,
        picture: null,
      }),
    });

    // First call — creates user
    const firstReq = { body: { idToken: "tok1", role: "user" }, headers: {} };
    const firstRes = makeRes();
    await googleAuth(firstReq, firstRes);
    expect(firstRes.statusCode).to.equal(200);
    const firstUserId = firstRes.body.user._id || firstRes.body.user.id;

    // Clear the session created by the first call so the second call doesn't
    // hit the "Already login" guard (one-device policy).
    await Session.deleteMany({ userId: firstUserId });

    // Second call with same Google identity
    const secondReq = { body: { idToken: "tok2", role: "user" }, headers: {} };
    const secondRes = makeRes();
    await googleAuth(secondReq, secondRes);

    expect(secondRes.statusCode, "second login status").to.equal(200);
    expect(secondRes.body).to.have.property("success", true);
    const secondUserId = secondRes.body.user._id || secondRes.body.user.id;

    // Same user id — not a duplicate
    expect(secondUserId.toString()).to.equal(firstUserId.toString());

    const userCount = await User.countDocuments({ email: googleEmail });
    expect(userCount, "exactly one user for this email").to.equal(1);
  });

  it("Google auth with role mismatch is rejected with 403", async () => {
    // Counsellor signs up first via Google
    const counsEmail = `gmismatch-${uniq}@gchatflow.test`;
    const counsSub = `gsub-mismatch-${uniq}`;

    verifyStub.resolves({
      getPayload: () => ({
        email: counsEmail,
        email_verified: true,
        sub: counsSub,
        name: `${TEST_TAG} mismatch ${uniq}`,
        picture: null,
      }),
    });

    const firstReq = {
      body: { idToken: "tok-c", role: "counsellor" },
      headers: {},
    };
    const firstRes = makeRes();
    await googleAuth(firstReq, firstRes);
    expect(firstRes.statusCode).to.equal(200);
    const firstUserId = firstRes.body.user._id || firstRes.body.user.id;
    await Session.deleteMany({ userId: firstUserId });

    // Same email tries to log in as "user" — should be refused
    const secondReq = {
      body: { idToken: "tok-c2", role: "user" },
      headers: {},
    };
    const secondRes = makeRes();
    await googleAuth(secondReq, secondRes);

    expect(secondRes.statusCode).to.equal(403);
    expect(secondRes.body).to.have.property("code", "ROLE_MISMATCH");
    expect(secondRes.body).to.have.property("actualRole", "counsellor");
  });

  it("invalid Google token returns 401", async () => {
    verifyStub.rejects(new Error("Invalid token"));

    const req = {
      body: { idToken: "bogus", role: "user" },
      headers: {},
    };
    const res = makeRes();
    await googleAuth(req, res);

    expect(res.statusCode).to.equal(401);
    expect(res.body).to.have.property("success", false);
    expect(res.body.message).to.match(/invalid google token/i);
  });
});

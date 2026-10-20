import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import AIConsent from "../src/models/AIConsent.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import consentRoutes from "../src/routes/aiConsentRoutes.js";
import chatRoutes from "../src/routes/chatRoutes.js";
import avatarRoutes from "../src/routes/avatarRoutes.js";
import aiRoutes from "../src/routes/aiRoutes.js";
import privacyRoutes from "../src/routes/privacyRoutes.js";
import { authMiddleware } from "../src/middleware/authMiddleware.js";
import {
  aiContext,
  consentFetch,
  CONSENT_VERSION,
  requireAIConsent,
} from "../src/services/aiConsent.js";
import { generateAIResponse } from "../src/services/aiService.js";

const A = "100000000000000000000001";
const B = "100000000000000000000002";
const sid = "200000000000000000000001";
const copy = (value) => (value ? structuredClone(value) : null);
describe("AI consent security (mocked database and provider)", () => {
  let sandbox, states, app, provider;
  const token = (id) =>
    jwt.sign({ userId: id, sessionId: sid }, process.env.ACCESS_SECRET);
  const auth = (req, id = A) => req.set("Authorization", `Bearer ${token(id)}`);
  const apply = (state, update) => {
    Object.assign(state, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete state[key];
    if (update.$addToSet?.activeCalls)
      state.activeCalls = [
        ...new Set([
          ...(state.activeCalls || []),
          update.$addToSet.activeCalls,
        ]),
      ];
    if (update.$push?.events)
      state.events = [
        ...(state.events || []),
        ...update.$push.events.$each,
      ].slice(-100);
    return copy(state);
  };
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    states = new Map();
    process.env.ACCESS_SECRET = "unit-test-access-secret";
    process.env.OPENAI_API_KEY = "unit-test-key";
    sandbox
      .stub(User, "findById")
      .callsFake(async (id) => ({
        _id: id,
        role: "user",
        isActive: true,
        isOnline: true,
      }));
    sandbox.stub(Session, "findOne").resolves({ _id: sid, isActive: true });
    sandbox.stub(Session, "updateOne").resolves({ acknowledged: true });
    sandbox
      .stub(AIConsent, "findOne")
      .callsFake(async (filter) => copy(states.get(String(filter.userId))));
    sandbox.stub(AIConsent, "updateOne").callsFake(async (filter, update) => {
      const id = String(filter.userId || filter._id);
      if (!states.has(id) && update.$setOnInsert)
        states.set(id, {
          _id: id,
          userId: id,
          provider: "OpenAI",
          activeCalls: [],
          ...update.$setOnInsert,
        });
      const state = states.get(id);
      if (state && (!filter.lockToken || filter.lockToken === state.lockToken))
        apply(state, update);
      return { acknowledged: true };
    });
    sandbox
      .stub(AIConsent, "findOneAndUpdate")
      .callsFake(async (filter, update) => {
        const state = states.get(String(filter.userId));
        if (!state || state.lockUntil > filter.lockUntil.$lte) return null;
        return apply(state, update);
      });
    sandbox
      .stub(AIConsent, "findByIdAndUpdate")
      .callsFake(async (id, update) => apply(states.get(String(id)), update));
    provider = sandbox
      .stub(globalThis, "fetch")
      .callsFake(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Mock AI response" } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      );
    app = express();
    app.use(express.json());
    app.use("/api/ai/consent", consentRoutes);
    app.use("/api/ai-chat", chatRoutes);
    app.use("/api/avatar", avatarRoutes);
    app.use("/api/ai", aiRoutes);
    app.use("/privacy", privacyRoutes);
    app.post("/probe", authMiddleware, requireAIConsent, async (req, res) => {
      try {
        res.json({ reply: await generateAIResponse(req.body.message) });
      } catch {
        res.status(502).json({ message: "AI unavailable" });
      }
    });
  });
  afterEach(() => sandbox.restore());
  const grant = (id) =>
    auth(request(app).post("/api/ai/consent"), id).send({
      accepted: true,
      consentVersion: CONSENT_VERSION,
    });
  it("defaults to no consent without contacting OpenAI", async () => {
    const r = await auth(request(app).get("/api/ai/consent"));
    expect(r.body.consented).to.equal(false);
    expect(provider.callCount).to.equal(0);
  });
  it("requires explicit true and the active disclosure version", async () => {
    for (const accepted of [false, "true", 1, null])
      expect(
        (
          await auth(request(app).post("/api/ai/consent")).send({
            accepted,
            consentVersion: CONSENT_VERSION,
          })
        ).status
      ).to.equal(400);
    expect(
      (
        await auth(request(app).post("/api/ai/consent")).send({
          accepted: true,
          consentVersion: "old",
        })
      ).status
    ).to.equal(400);
    expect(states.size).to.equal(0);
  });
  it("persists server timestamps and permits an explicitly accepted OpenAI request", async () => {
    const r = await grant(A);
    expect(r.body.consented).to.equal(true);
    expect(states.get(A).consentedAt).to.be.instanceOf(Date);
    expect(
      (await auth(request(app).post("/probe")).send({ message: "hello" })).body
        .reply
    ).to.equal("Mock AI response");
    expect(provider.callCount).to.equal(1);
    const payload = JSON.parse(provider.firstCall.args[1].body);
    expect(payload.store).to.equal(false);
  });
  it("never trusts a client-supplied userId", async () => {
    await auth(request(app).post("/api/ai/consent")).send({
      accepted: true,
      consentVersion: CONSENT_VERSION,
      userId: B,
    });
    expect(states.has(A)).to.equal(true);
    expect(states.has(B)).to.equal(false);
  });
  for (const path of [
    "/api/ai-chat/send-message",
    "/api/ai-chat/tts",
    "/api/ai/message",
    "/api/ai/realtime/session",
    "/api/avatar/analyze-and-generate",
    "/api/avatar/customize",
  ]) {
    it(`blocks ${path} without consent and makes zero provider calls`, async () => {
      const r = await auth(request(app).post(path)).send({
        message: "private",
        text: "private",
      });
      expect(r.status).to.equal(403);
      expect(r.body.code).to.equal("AI_CONSENT_REQUIRED");
      expect(provider.callCount).to.equal(0);
    });
  }
  it("blocks the mobile GET speech endpoint", async () => {
    const r = await auth(request(app).get("/api/ai-chat/tts?text=private"));
    expect(r.status).to.equal(403);
    expect(provider.callCount).to.equal(0);
  });
  it("rejects missing or invalid JWTs before any provider call", async () => {
    for (const header of ["", "Bearer invalid"])
      expect(
        (
          await request(app)
            .post("/api/ai-chat/send-message")
            .set("Authorization", header)
            .send({ message: "private" })
        ).status
      ).to.equal(401);
    expect(provider.callCount).to.equal(0);
  });
  it("does not reuse account A consent for account B", async () => {
    await grant(A);
    expect(
      (await auth(request(app).post("/probe"), B).send({ message: "private" }))
        .status
    ).to.equal(403);
    expect(provider.callCount).to.equal(0);
  });
  it("revokes consent and blocks future calls", async () => {
    await grant(A);
    expect(
      (await auth(request(app).delete("/api/ai/consent"))).body.consented
    ).to.equal(false);
    expect(states.get(A).revokedAt).to.be.instanceOf(Date);
    expect(
      (await auth(request(app).post("/probe")).send({ message: "private" }))
        .status
    ).to.equal(403);
    expect(provider.callCount).to.equal(0);
  });
  it("requires renewed acceptance when the saved version is stale", async () => {
    await grant(A);
    states.get(A).consentVersion = "previous";
    expect(
      (await auth(request(app).post("/probe")).send({ message: "private" }))
        .status
    ).to.equal(403);
    expect(provider.callCount).to.equal(0);
  });
  for (const [label, invalid] of [
    ["missing acceptance timestamp", { consentedAt: null }],
    ["invalid acceptance timestamp", { consentedAt: new Date(NaN) }],
    ["future acceptance timestamp", { consentedAt: new Date(Date.now() + 86400000) }],
    ["revocation timestamp with inconsistent granted flag", { revokedAt: new Date() }],
  ]) {
    it(`rejects ${label} at both status and transmission checks`, async () => {
      await grant(A);
      Object.assign(states.get(A), invalid);
      expect((await auth(request(app).get("/api/ai/consent"))).body.consented).to.equal(false);
      expect((await auth(request(app).post("/probe")).send({ message: "synthetic" })).status).to.equal(403);
      let failure;
      try {
        await aiContext.run({ userId: A }, () => consentFetch("https://api.openai.com/v1/chat/completions", { method: "POST" }));
      } catch (error) { failure = error; }
      expect(failure?.code).to.equal("AI_CONSENT_REQUIRED");
      expect(provider.callCount).to.equal(0);
    });
  }
  it("rejects an expired access token before consent or provider work", async () => {
    await grant(A);
    const expired = jwt.sign({ userId: A, sessionId: sid }, process.env.ACCESS_SECRET, { expiresIn: -1 });
    const r = await request(app).post("/probe").set("Authorization", `Bearer ${expired}`).send({ message: "synthetic" });
    expect(r.status).to.equal(401);
    expect(r.body.code).to.equal("TOKEN_EXPIRED");
    expect(provider.callCount).to.equal(0);
  });
  it("returns a safe provider failure and does not silently retry or enable another provider", async () => {
    await grant(A);
    provider.resolves(new Response(JSON.stringify({ error: { message: "private provider content" } }), {
      status: 503, headers: { "content-type": "application/json" },
    }));
    const r = await auth(request(app).post("/api/ai-chat/tts")).send({ text: "synthetic" });
    expect(r.status).to.equal(502);
    expect(r.body.code).to.equal("AI_PROVIDER_UNAVAILABLE");
    expect(r.text).not.to.include("private provider content");
    expect(provider.callCount).to.equal(1);
    expect((await auth(request(app).get("/api/ai/consent"))).body.consented).to.equal(true);
  });
  it("rejects background work without authenticated request context", async () => {
    try {
      await generateAIResponse("private");
      throw new Error("Expected rejection");
    } catch {}
    expect(provider.callCount).to.equal(0);
  });
  it("rechecks consent at transmission time after middleware has run", async () => {
    await grant(A);
    states.get(A).consentGranted = false;
    try {
      await aiContext.run({ userId: A }, () =>
        consentFetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          body: "private",
        })
      );
    } catch (error) {
      expect(error.code).to.equal("AI_CONSENT_REQUIRED");
    }
    expect(provider.callCount).to.equal(0);
  });
  it("registers realtime calls and terminates them during withdrawal", async () => {
    await grant(A);
    provider
      .onFirstCall()
      .resolves(
        new Response("sdp", {
          status: 201,
          headers: { location: "/v1/realtime/calls/rtc_test" },
        })
      );
    await aiContext.run({ userId: A }, () =>
      consentFetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
      })
    );
    expect(states.get(A).activeCalls).to.deep.equal(["rtc_test"]);
    provider.onSecondCall().resolves(new Response(null, { status: 200 }));
    expect(
      (await auth(request(app).delete("/api/ai/consent"))).status
    ).to.equal(200);
    expect(provider.secondCall.args[0]).to.include("/rtc_test/hangup");
    expect(states.get(A).activeCalls).to.deep.equal([]);
  });
  it("keeps future AI disabled and allows retry when remote hangup fails", async () => {
    await grant(A);
    states.get(A).activeCalls = ["rtc_test"];
    provider.resolves(new Response("private provider error", { status: 500 }));
    const r = await auth(request(app).delete("/api/ai/consent"));
    expect(r.status).to.equal(503);
    expect(states.get(A).consentGranted).to.equal(false);
    expect(r.text).not.to.include("private provider error");
  });
  it("returns safe speech errors without provider content or keys", async () => {
    await grant(A);
    provider.resolves(
      new Response(
        JSON.stringify({
          error: { message: "secret private content", type: "failure" },
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      )
    );
    const r = await auth(request(app).post("/api/ai-chat/tts")).send({
      text: "private",
    });
    expect(r.status).to.equal(502);
    expect(r.text).not.to.include("secret private content");
    expect(r.text).not.to.include("unit-test-key");
  });
  it("does not log or return private content from invalid avatar analysis", async () => {
    await grant(A);
    const previous = process.env.AVATAR_ENABLE_ANALYSIS;
    process.env.AVATAR_ENABLE_ANALYSIS = "true";
    const log = sandbox.stub(console, "log");
    const errorLog = sandbox.stub(console, "error");
    provider.resolves(new Response(JSON.stringify({ choices: [{ message: { content: "private-photo-analysis{invalid" } }] }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    try {
      const r = await auth(request(app).post("/api/avatar/analyze-and-generate")).send({ photoBase64: "aGVsbG8=" });
      expect(r.status).to.equal(500);
      expect(r.body.error).to.equal("Invalid AI photo analysis");
      expect(r.text).not.to.include("private-photo-analysis");
      expect(JSON.stringify([...log.args, ...errorLog.args])).not.to.include("private-photo-analysis");
    } finally {
      if (previous === undefined) delete process.env.AVATAR_ENABLE_ANALYSIS;
      else process.env.AVATAR_ENABLE_ANALYSIS = previous;
    }
  });
  it("fails closed on database outage", async () => {
    AIConsent.findOne.rejects(new Error("database private details"));
    const r = await auth(request(app).post("/probe")).send({
      message: "private",
    });
    expect(r.status).to.equal(503);
    expect(provider.callCount).to.equal(0);
    expect(r.text).not.to.include("database private");
  });
  it("preserves AI_CONSENT_REQUIRED when the SDK wraps a revocation race", async () => {
    await grant(A);
    AIConsent.findOne.callsFake(async () => {
      const snapshot = copy(states.get(A));
      states.get(A).consentGranted = false;
      return snapshot;
    });
    const r = await auth(request(app).post("/api/ai-chat/tts")).send({
      text: "private",
    });
    expect(r.status).to.equal(403);
    expect(r.body.code).to.equal("AI_CONSENT_REQUIRED");
    expect(provider.callCount).to.equal(0);
  });
  it("serializes queued transmission against a completed withdrawal", async () => {
    await grant(A);
    let finish;
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    provider.callsFake(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const sending = aiContext.run({ userId: A }, () =>
      consentFetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
      })
    );
    await ready;
    const withdrawing = auth(request(app).delete("/api/ai/consent")).then(
      (response) => response
    );
    finish(new Response("{}", { status: 200 }));
    await sending;
    expect((await withdrawing).status).to.equal(200);
    const r = await auth(request(app).post("/probe")).send({
      message: "private",
    });
    expect(r.status).to.equal(403);
    expect(provider.callCount).to.equal(1);
  });
  it("serves the policy without a login on a responsive page", async () => {
    const r = await request(app).get("/privacy");
    expect(r.status).to.equal(200);
    expect(r.text).to.include('name="viewport"');
    expect(r.text).to.include("OpenAI");
    expect(r.text).to.include("support@humaeli.com");
  });
});

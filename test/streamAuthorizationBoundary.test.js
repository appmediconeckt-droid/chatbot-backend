import { expect } from "chai";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import { StreamChat } from "stream-chat";
import Call from "../src/models/Call.js";
import UserBlock from "../src/models/UserBlock.js";
import { getStreamToken } from "../src/controllers/streamController.js";

describe("Stream API authorization boundary (provider mocked, not external verification)", () => {
  let saved, upsert;
  beforeEach(() => {
    saved = [process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET];
    process.env.STREAM_API_KEY = `synthetic-${Date.now()}-${Math.random()}`;
    process.env.STREAM_API_SECRET = "synthetic-stream-provider-secret";
    upsert = sinon.stub().resolves({});
    sinon.stub(StreamChat, "getInstance").returns({ upsertUsers: upsert });
    sinon.stub(UserBlock, "exists").resolves(null);
  });
  afterEach(() => {
    sinon.restore();
    ["STREAM_API_KEY", "STREAM_API_SECRET"].forEach((key, index) => saved[index] === undefined ? delete process.env[key] : process.env[key] = saved[index]);
  });
  const res = () => ({ statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, set(k, v) { this.headers[k] = v; return this; } });
  const A = "100000000000000000000001", B = "100000000000000000000002", C = "100000000000000000000003";
  it("two authorized identities receive only the accepted call membership and a short expiry", async () => {
    const find = sinon.stub(Call, "find").callsFake(filter => {
      expect(filter.status).to.equal("active"); expect(filter.isActive).to.equal(true); expect(filter.acceptedAt).to.deep.equal({ $ne: null }); expect(filter.callId).to.equal("synthetic-call");
      expect([A, B]).to.include(filter.$or[0].callerId); expect(filter.$or[1].receiverId).to.equal(filter.$or[0].callerId);
      return { limit: async () => [{ callId: "synthetic-call", callerId: A, receiverId: B }] };
    });
    for (const id of [A, B]) {
      const response = res(); await getStreamToken({ user: { _id: id }, query: { callId: "synthetic-call" } }, response);
      expect(response.statusCode).to.equal(200); expect(response.headers["Cache-Control"]).to.equal("no-store");
      const claims = jwt.verify(response.body.token, "synthetic-stream-provider-secret");
      expect(claims.user_id).to.equal(id); expect(claims.call_cids).to.deep.equal(["default:synthetic-call"]); expect(claims.exp - claims.iat).to.equal(300); expect(claims).not.to.have.property("role");
    }
    expect(find.callCount).to.equal(2); expect(upsert.callCount).to.equal(2);
  });
  it("the third user cannot obtain a provider token for the other pair's call", async () => {
    sinon.stub(Call, "find").callsFake(filter => { expect(filter.$or).to.deep.equal([{ callerId: C }, { receiverId: C }]); return { limit: async () => [] }; });
    const response = res(); await getStreamToken({ user: { _id: C }, query: { callId: "synthetic-call" } }, response);
    expect(response.statusCode).to.equal(403); expect(upsert.called).to.equal(false); expect(response.body).not.to.have.property("token");
  });
  it("a newly blocked pair cannot refresh call membership tokens", async () => {
    UserBlock.exists.resolves({ _id: "synthetic-block" });
    sinon.stub(Call, "find").returns({ limit: async () => [{ callId: "synthetic-call", callerId: A, receiverId: B }] });
    const response = res(); await getStreamToken({ user: { _id: A }, query: { callId: "synthetic-call" } }, response);
    expect(response.statusCode).to.equal(403); expect(upsert.called).to.equal(false);
  });
  it("authorization storage failure fails closed without a provider token", async () => {
    sinon.stub(Call, "find").returns({ limit: async () => { throw new Error("synthetic storage failure"); } });
    const response = res(); await getStreamToken({ user: { _id: A }, query: { callId: "synthetic-call" } }, response);
    expect(response.statusCode).to.equal(503); expect(upsert.called).to.equal(false); expect(response.body).not.to.have.property("token");
  });
});

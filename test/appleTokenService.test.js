import { expect } from "chai";
import sinon from "sinon";
import User from "../src/models/userModel.js";
import { deleteUser } from "../src/controllers/authController.js";
import {
  encryptAppleToken,
  decryptAppleToken,
  exchangeAppleCode,
  revokeAppleAuthorization,
} from "../src/services/appleTokenService.js";
const keys = [
  "APPLE_CLIENT_SECRET",
  "APPLE_TOKEN_ENCRYPTION_KEY",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
];
describe("Apple account token lifecycle", () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);
    process.env.APPLE_CLIENT_SECRET = "fixture-client-secret";
    process.env.APPLE_TOKEN_ENCRYPTION_KEY = "11".repeat(32);
  });
  afterEach(() => {
    sinon.restore();
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  it("encrypts tokens with authenticated encryption and rejects tampering", () => {
    const encrypted = encryptAppleToken("fixture-refresh");
    expect(encrypted).not.to.contain("fixture-refresh");
    expect(decryptAppleToken(encrypted)).to.equal("fixture-refresh");
    const pieces = encrypted.split(".");
    pieces[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptAppleToken(pieces.join("."))).to.throw();
  });
  it("binds an exchanged authorization code to the verified Apple account", async () => {
    const fetch = sinon
      .stub(globalThis, "fetch")
      .resolves(
        new Response(
          JSON.stringify({
            refresh_token: "fixture-refresh",
            id_token: "fixture-identity",
          }),
          { status: 200 }
        )
      );
    const encrypted = await exchangeAppleCode(
      "fixture-code",
      "apple-user",
      async () => ({ sub: "apple-user" })
    );
    expect(decryptAppleToken(encrypted)).to.equal("fixture-refresh");
    expect(fetch.firstCall.args[0]).to.equal(
      "https://appleid.apple.com/auth/token"
    );
    expect(fetch.firstCall.args[1].body.get("grant_type")).to.equal(
      "authorization_code"
    );
  });
  it("rejects an authorization code belonging to a different Apple user", async () => {
    sinon
      .stub(globalThis, "fetch")
      .resolves(
        new Response(
          JSON.stringify({
            refresh_token: "fixture-refresh",
            id_token: "fixture-identity",
          }),
          { status: 200 }
        )
      );
    let caught;
    try {
      await exchangeAppleCode("fixture-code", "apple-user", async () => ({
        sub: "other-user",
      }));
    } catch (error) {
      caught = error;
    }
    expect(caught.code).to.equal("APPLE_ID_MISMATCH");
  });
  it("revokes only the stored user's Apple refresh token", async () => {
    const fetch = sinon
      .stub(globalThis, "fetch")
      .resolves(new Response(null, { status: 200 }));
    await revokeAppleAuthorization({
      appleId: "apple-user",
      appleTokenCiphertext: encryptAppleToken("fixture-refresh"),
    });
    expect(fetch.firstCall.args[0]).to.equal(
      "https://appleid.apple.com/auth/revoke"
    );
    expect(fetch.firstCall.args[1].body.get("token")).to.equal(
      "fixture-refresh"
    );
    expect(fetch.firstCall.args[1].body.get("token_type_hint")).to.equal(
      "refresh_token"
    );
  });
  it("does not call Apple for local accounts", async () => {
    const fetch = sinon.stub(globalThis, "fetch");
    await revokeAppleAuthorization({});
    expect(fetch.called).to.equal(false);
  });
  it("never serializes Apple token material in account responses", () => {
    const user = new User({
      fullName: "Fixture",
      appleId: "fixture",
      appleTokenCiphertext: encryptAppleToken("fixture-refresh"),
    });
    expect(user.toJSON()).not.to.have.property("appleTokenCiphertext");
  });
  it("preserves local account data if Apple revocation cannot yet be performed", async () => {
    sinon
      .stub(User, "findById")
      .returns({ select: async () => ({ appleId: "apple-user" }) });
    const remove = sinon.stub(User, "findByIdAndDelete");
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await deleteUser({ userId: "fixture-id" }, res);
    expect(res.status.calledWith(409)).to.equal(true);
    expect(
      res.json.calledWithMatch({ code: "APPLE_REAUTH_REQUIRED" })
    ).to.equal(true);
    expect(remove.called).to.equal(false);
  });
});

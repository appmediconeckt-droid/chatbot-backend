import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import PrivateAsset from "../src/models/PrivateAsset.js";
import Message from "../src/models/Message.js";
import { authenticateToken } from "../src/middleware/auth.js";
import { updateUserById, getAllCounsellors } from "../src/controllers/authController.js";
import { resolveProfileAsset } from "../src/services/profileAssetReferences.js";

const accountId = "100000000000000000000001";
const otherId = "100000000000000000000002";
const sessionId = "100000000000000000000003";
const assetId = "100000000000000000000004";
const assetUrl = `/api/private-files/${assetId}`;

describe("Authenticated profile and storage boundaries", () => {
  afterEach(() => sinon.restore());

  for (const role of ["user", "counsellor"]) {
    const setup = () => {
      const account = { _id: accountId, role, isActive: true, isVerified: false,
        certifications: [], toObject() { return { role }; } };
      sinon.stub(Session, "findOne").resolves({ _id: sessionId });
      sinon.stub(User, "findById").resolves(account);
      const write = sinon.stub(User, "findByIdAndUpdate").returns({ select: async () => account });
      const app = express();
      app.use(express.json());
      app.patch("/profile/:userId", authenticateToken, updateUserById);
      const token = jwt.sign({ userId: accountId, sessionId, role }, process.env.ACCESS_SECRET, { expiresIn: 600 });
      return { app, token, write, account };
    };

    it(`${role} cannot update another account through the authenticated API`, async () => {
      const { app, token, write } = setup();
      const res = await request(app).patch(`/profile/${otherId}`).set("Authorization", `Bearer ${token}`).send({ fullName: "Changed" });
      expect(res.status).to.equal(403);
      expect(write.called).to.equal(false);
    });

    it(`${role} cannot self-assign privileges, verification, financial flags or ratings`, async () => {
      const { app, token, write } = setup();
      const res = await request(app).patch(`/profile/${accountId}`).set("Authorization", `Bearer ${token}`).send({
        fullName: "Synthetic updated name", role: "admin", isVerified: true, isActive: false,
        rating: 5, totalSessions: 999, activeClients: 999, walletBalance: 999,
        demoPaymentsEnabled: true, locationData: { isVerified: true },
      });
      expect(res.status).to.equal(200);
      const updates = write.firstCall.args[1].$set;
      expect(updates.fullName).to.equal("Synthetic updated name");
      for (const field of ["role", "isVerified", "isActive", "rating", "totalSessions", "activeClients", "walletBalance", "demoPaymentsEnabled", "locationData"]) {
        expect(updates).not.to.have.property(field);
      }
    });

    it(`${role} cannot save an unrelated historical file as a certification`, async () => {
      const { app, token, write } = setup();
      const res = await request(app).patch(`/profile/${accountId}`).set("Authorization", `Bearer ${token}`).send({
        certifications: [{ name: "Synthetic", documentUrl: "/uploads/other-account.pdf", documentPublicId: "other-provider-id" }],
      });
      expect(res.status).to.equal(403);
      expect(write.called).to.equal(false);
    });

    it(`${role} cannot update without authentication`, async () => {
      const { app, write } = setup();
      expect((await request(app).patch(`/profile/${accountId}`).send({ fullName: "Changed" })).status).to.equal(401);
      expect(write.called).to.equal(false);
    });
  }

  it("denies foreign private assets with owner, purpose and snapshot constraints in the query", async () => {
    const lookup = sinon.stub(PrivateAsset, "findOne").resolves(null);
    expect(await resolveProfileAsset(assetUrl, accountId, "certification")).to.equal(null);
    expect(lookup.firstCall.args[0]).to.deep.equal({ _id: assetId, ownerId: accountId, purpose: "certification", prescriptionId: { $exists: false } });
  });

  it("uses stored metadata for owned assets and preserves an existing historical reference", async () => {
    const lookup = sinon.stub(PrivateAsset, "findOne").resolves({ _id: assetId, size: 123, name: "synthetic.pdf" });
    expect(await resolveProfileAsset(assetUrl, accountId, "certification")).to.deep.equal({ url: assetUrl, publicId: `private:${assetId}`, bytes: 123, name: "synthetic.pdf" });
    const existing = { url: "https://storage.example/legacy.pdf", publicId: "trusted-server-id" };
    expect(await resolveProfileAsset(existing.url, accountId, "certification", [existing])).to.equal(existing);
    expect(lookup.calledOnce).to.equal(true);
  });

  it("denies new external, legacy and data URL references", async () => {
    const lookup = sinon.stub(PrivateAsset, "findOne");
    for (const url of ["https://storage.example/new.pdf", "/uploads/other.pdf", "data:image/png;base64,AAAA"]) {
      expect(await resolveProfileAsset(url, accountId, "prescription")).to.equal(null);
    }
    expect(lookup.called).to.equal(false);
  });

  it("treats directory location search as literal text", async () => {
    const lookup = sinon.stub(User, "find").returns({ select: () => ({ sort: () => ({ lean: async () => [] }) }) });
    sinon.stub(Message, "aggregate").resolves([]);
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await getAllCounsellors({ query: { location: "(a+)+$" } }, res);
    expect(lookup.firstCall.args[0].location.$regex).to.equal("\\(a\\+\\)\\+\\$");
    expect(res.status.calledWith(200)).to.equal(true);
  });

  for (const query of [{ location: { $ne: "" } }, { specialization: ["x"] }, { location: "x".repeat(201) }, { minExperience: "NaN" }]) {
    it(`rejects malformed directory filters ${JSON.stringify(query).slice(0, 70)}`, async () => {
      const lookup = sinon.stub(User, "find");
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await getAllCounsellors({ query }, res);
      expect(res.status.calledWith(400)).to.equal(true);
      expect(lookup.called).to.equal(false);
    });
  }
});

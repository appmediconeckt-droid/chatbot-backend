import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import { uploadPrescriptionPdf, uploadPrescriptionPhoto } from "../src/middleware/multerConfig.js";
import { reviewPatientPhoto } from "../src/controllers/prescriptionController.js";
import Prescription from "../src/models/Prescription.js";
import User from "../src/models/userModel.js";
import PrivateAsset from "../src/models/PrivateAsset.js";

describe("Clinical upload and signature boundaries", () => {
  afterEach(() => sinon.restore());
  for (const [field, mime, middleware, valid] of [
    ["attachment", "application/pdf", uploadPrescriptionPdf, Buffer.from("%PDF-1.4\nsynthetic")],
    ["photo", "image/png", uploadPrescriptionPhoto, Buffer.from("89504e470d0a1a0a00000000", "hex")],
  ]) {
    it(`${field} rejects MIME spoofing and accepts supported bytes`, async () => {
      const app = express();
      app.post("/upload", middleware, (_req, res) => res.sendStatus(204));
      expect((await request(app).post("/upload").attach(field, Buffer.from("<html>synthetic</html>"), { filename: "synthetic", contentType: mime })).status).to.equal(400);
      expect((await request(app).post("/upload").attach(field, valid, { filename: "synthetic", contentType: mime })).status).to.equal(204);
    });
  }
  it("cannot insert another consultant's private signature into a prescription review", async () => {
    const save = sinon.spy();
    sinon.stub(Prescription, "findOne").resolves({ patientPhoto: { mimeType: "image/png" }, psychiatristSnapshot: {}, save });
    sinon.stub(User, "findById").returns({ lean: async () => ({ _id: "100000000000000000000001" }) });
    sinon.stub(PrivateAsset, "findOne").resolves(null);
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await reviewPatientPhoto({ params: { id: "synthetic" }, user: { _id: "100000000000000000000001", role: "counsellor" }, body: { action: "approve", signatureUrl: "/api/private-files/100000000000000000000002" } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
    expect(save.called).to.equal(false);
  });
});

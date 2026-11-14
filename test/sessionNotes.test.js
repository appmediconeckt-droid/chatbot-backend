import { expect } from "chai";
import sinon from "sinon";
import Appointment from "../src/models/appointmentModel.js";
import { updateSessionNote, getAppointments } from "../src/controllers/appointmentController.js";

const id = "507f1f77bcf86cd799439011";
const owner = "507f1f77bcf86cd799439012";
const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });
const req = (sessionNote = " Follow up ") => ({ params: { id }, user: { _id: owner, role: "counsellor" }, body: { sessionNote } });
describe("Private consultant session notes", () => {
  afterEach(() => sinon.restore());
  it("saves trimmed notes using an atomic owner-scoped update without changing booking notes", async () => {
    const update = sinon.stub(Appointment, "findOneAndUpdate").returns({ select: async () => ({ _id: id, sessionNote: "Follow up" }) });
    const res = response();
    await updateSessionNote(req(), res);
    expect(update.firstCall.args[0]).to.deep.equal({ _id: id, counselor: owner });
    expect(update.firstCall.args[1]).to.deep.equal({ $set: { sessionNote: "Follow up" } });
    expect(res.json.firstCall.args[0].appointment.sessionNote).to.equal("Follow up");
  });
  it("denies patients", async () => {
    const request = req(); request.user.role = "user";
    const res = response(); await updateSessionNote(request, res);
    expect(res.status.calledWith(403)).to.equal(true);
  });
  for (const note of [undefined, null, {}, "   ", "x".repeat(5001)]) {
    it(`rejects invalid note ${typeof note} of length ${note?.length}`, async () => {
      const request = req(); request.body.sessionNote = note;
      const res = response(); await updateSessionNote(request, res);
      expect(res.status.calledWith(400)).to.equal(true);
    });
  }
  it("rejects invalid appointment IDs", async () => {
    const request = req(); request.params.id = "bad-id";
    const res = response(); await updateSessionNote(request, res);
    expect(res.status.calledWith(400)).to.equal(true);
  });
  it("returns 404 for another consultant's or missing appointment", async () => {
    sinon.stub(Appointment, "findOneAndUpdate").returns({ select: async () => null });
    const res = response(); await updateSessionNote(req(), res);
    expect(res.status.calledWith(404)).to.equal(true);
  });
  it("reports database errors", async () => {
    sinon.stub(Appointment, "findOneAndUpdate").returns({ select: async () => { throw new Error("db"); } });
    const res = response(); await updateSessionNote(req(), res);
    expect(res.status.calledWith(500)).to.equal(true);
  });
  it("excludes private notes from ordinary queries by default", () => {
    expect(Appointment.schema.path("sessionNote").options.select).to.equal(false);
  });
  for (const role of ["user", "counsellor"]) {
    it(`loads session notes only for the owning consultant (${role})`, async () => {
      sinon.stub(Appointment, "deleteMany").resolves({ deletedCount: 0 });
      const query = { select: sinon.stub().returnsThis(), populate: sinon.stub().returnsThis(), sort: sinon.stub().returnsThis(), lean: sinon.stub().resolves([
        { _id: id, counselor: { _id: owner }, patient: { _id: "patient", anonymous: "River" }, ...(role === "counsellor" ? { sessionNote: "Private" } : {}) },
      ]) };
      sinon.stub(Appointment, "find").returns(query);
      const res = response(); await getAppointments({ user: { _id: owner, role }, query: {} }, res);
      expect(query.select.calledWith("+sessionNote")).to.equal(role === "counsellor");
      expect(res.json.firstCall.args[0][0].sessionNote).to.equal(role === "counsellor" ? "Private" : undefined);
    });
  }
});

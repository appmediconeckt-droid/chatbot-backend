import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import User from "../src/models/userModel.js";
import Chat from "../src/models/Chat.js";
import { getLandingStats } from "../src/controllers/authController.js";
import { authRoutes } from "../src/routes/authRoutes.js";

describe("Landing stats endpoint", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("registers GET /landing-stats on auth routes", function () {
    const route = authRoutes.stack.find(
      (layer) => layer.route?.path === "/landing-stats" && layer.route?.methods?.get,
    );

    expect(route).to.exist;
  });

  it("returns public aggregate counters", async function () {
    const countDocumentsStub = sandbox.stub(User, "countDocuments");
    countDocumentsStub.withArgs({ role: "user" }).resolves(125);
    countDocumentsStub.withArgs({ role: "counsellor" }).resolves(18);
    countDocumentsStub.withArgs({ role: "counsellor", isOnline: true }).resolves(4);
    sandbox
      .stub(Chat, "countDocuments")
      .withArgs({ status: "closed", closedAt: { $ne: null } })
      .resolves(42);

    const res = {
      json: sinon.spy(),
      status: sinon.stub().returnsThis(),
    };

    await getLandingStats({}, res);

    expect(res.status.notCalled).to.equal(true);
    expect(res.json.calledOnceWithExactly({
      success: true,
      data: {
        patientsHelped: 125,
        medicalPartners: 18,
        activeSupports: 4,
        completedPatients: 42,
      },
    })).to.equal(true);
  });
});

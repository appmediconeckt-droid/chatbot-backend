import { expect } from "chai";
import sinon from "sinon";
import { updateUserById } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";

describe("Counsellor profile update certification validation", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("rejects profile updates when more than five certification documents are submitted", async function () {
    const currentUser = {
      _id: "user123",
      role: "counsellor",
      certifications: [],
    };

    sandbox.stub(User, "findById").resolves(currentUser);
    const findByIdAndUpdateStub = sandbox.stub(User, "findByIdAndUpdate").returns({
      select: sinon.stub().resolves({}),
    });

    const req = {
      params: { userId: "user123" },
      body: {
        fullName: "Test Counselor",
        certifications: Array.from({ length: 6 }, (_, index) => ({
          name: `Document ${index + 1}`,
        })),
      },
      files: {},
    };
    const res = {
      status: sinon.stub().returnsThis(),
      json: sinon.spy(),
    };

    await updateUserById(req, res);

    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.calledWithMatch(sinon.match.has("message", sinon.match(/maximum of 5/i)))).to.equal(true);
    expect(findByIdAndUpdateStub.notCalled).to.equal(true);
  });

  it("rejects profile updates when a new certification has no uploaded document image", async function () {
    const currentUser = {
      _id: "user123",
      role: "counsellor",
      certifications: [],
    };

    sandbox.stub(User, "findById").resolves(currentUser);
    const findByIdAndUpdateStub = sandbox.stub(User, "findByIdAndUpdate").returns({
      select: sinon.stub().resolves({}),
    });

    const req = {
      params: { userId: "user123" },
      body: {
        fullName: "Test Counselor",
        certifications: [
          {
            name: "Certificate A",
            documentUrl: "",
          },
        ],
      },
      files: {},
    };
    const res = {
      status: sinon.stub().returnsThis(),
      json: sinon.spy(),
    };

    await updateUserById(req, res);

    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.calledWithMatch(sinon.match.has("message", sinon.match(/upload.*document/i)))).to.equal(true);
    expect(findByIdAndUpdateStub.notCalled).to.equal(true);
  });
});

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

  it("accepts profile phone updates using the submitted country code", async function () {
    const currentUser = {
      _id: "user123",
      role: "user",
      phoneNumber: "9876543210",
      phoneCountryCode: "+91",
    };
    const updatedUser = {
      _id: "user123",
      role: "user",
      fullName: "Test User",
      email: "test@example.com",
      phoneNumber: "56555555455",
      phoneCountryCode: "+86",
    };

    sandbox.stub(User, "findById").resolves(currentUser);
    sandbox.stub(User, "findOne").returns({
      select: sinon.stub().returns({
        lean: sinon.stub().resolves(null),
      }),
    });
    const findByIdAndUpdateStub = sandbox.stub(User, "findByIdAndUpdate").returns({
      select: sinon.stub().resolves(updatedUser),
    });

    const req = {
      params: { userId: "user123" },
      body: {
        phoneNumber: "56555555455",
        phoneCountryCode: "+86",
      },
      files: {},
    };
    const res = {
      status: sinon.stub().returnsThis(),
      json: sinon.spy(),
    };

    await updateUserById(req, res);

    expect(res.status.calledWith(200)).to.equal(true);
    expect(findByIdAndUpdateStub.calledOnce).to.equal(true);
    expect(findByIdAndUpdateStub.firstCall.args[1].$set).to.include({
      phoneNumber: "56555555455",
      phoneCountryCode: "+86",
    });
    expect(res.json.calledWithMatch({ success: true })).to.equal(true);
  });
});

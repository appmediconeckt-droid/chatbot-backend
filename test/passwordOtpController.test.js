import { expect } from "chai";
import sinon from "sinon";
import { verifyPasswordOtp } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";
import OTP from "../src/models/otpModel.js";

describe("Password OTP controller", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  const createRes = () => ({
    status: sinon.stub().returnsThis(),
    json: sinon.spy(),
  });

  it("validates password OTP without consuming it", async function () {
    const user = { _id: "user123", email: "person@example.com" };
    sandbox.stub(User, "findOne").resolves(user);
    sandbox.stub(OTP, "findOne").resolves({
      userId: user._id,
      otp: "123456",
      expiresAt: new Date(Date.now() + 60 * 1000),
    });
    const deleteManyStub = sandbox.stub(OTP, "deleteMany").resolves({});

    const req = { body: { email: " Person@Example.com ", otp: "123456" } };
    const res = createRes();

    await verifyPasswordOtp(req, res);

    expect(User.findOne.calledWith({ email: "person@example.com" })).to.equal(true);
    expect(OTP.findOne.calledWith({ userId: user._id, otp: "123456" })).to.equal(true);
    expect(deleteManyStub.notCalled).to.equal(true);
    expect(res.status.calledWith(200)).to.equal(true);
    expect(res.json.calledWithMatch({ success: true })).to.equal(true);
  });

  it("clears expired password OTPs", async function () {
    const user = { _id: "user123", email: "person@example.com" };
    sandbox.stub(User, "findOne").resolves(user);
    sandbox.stub(OTP, "findOne").resolves({
      userId: user._id,
      otp: "123456",
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const deleteManyStub = sandbox.stub(OTP, "deleteMany").resolves({});

    const req = { body: { email: "person@example.com", otp: "123456" } };
    const res = createRes();

    await verifyPasswordOtp(req, res);

    expect(deleteManyStub.calledWith({ userId: user._id })).to.equal(true);
    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.calledWithMatch({ success: false, message: "OTP expired" })).to.equal(true);
  });
});

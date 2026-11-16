import { expect } from "chai";
import sinon from "sinon";
import { randomUUID } from "node:crypto";
import { sendPhoneOTP, verifyPhoneOTP, verifyEmailOTP } from "../src/controllers/authController.js";
import RegistrationOTP from "../src/models/registrationOtpModel.js";
import User from "../src/models/userModel.js";
import otpService from "../src/services/otpService.js";

const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });
describe("Phone OTP account binding and abuse prevention", () => {
  let email;
  const phoneNumber = "+919876543210";
  beforeEach(async () => {
    email = `${randomUUID()}@example.test`;
    sinon.stub(RegistrationOTP, "deleteMany").resolves({});
    sinon.stub(RegistrationOTP, "findOne").returns({ sort: () => ({ lean: async () => ({ otp: "123456" }) }) });
    sinon.stub(User, "findOne").resolves(null);
    sinon.stub(otpService, "generateOTPForAccount").resolves("234567");
    const res = response();
    await verifyEmailOTP({ body: { email, otp: "123456" } }, res);
    expect(res.status.calledWith(200)).to.equal(true);
  });
  afterEach(() => sinon.restore());

  const send = async body => {
    const res = response();
    await sendPhoneOTP({ body: { phoneNumber, ...body } }, res);
    return res;
  };
  const verify = async body => {
    const res = response();
    await verifyPhoneOTP({ body: { phoneNumber, otp: "234567", ...body } }, res);
    return res;
  };

  it("does not select another email verification when email is missing", async () => {
    expect((await send({})).status.calledWith(400)).to.equal(true);
    expect(otpService.generateOTPForAccount.called).to.equal(false);
  });
  it("binds verification to the explicit email and consumes a successful code once", async () => {
    expect((await send({ email })).status.calledWith(200)).to.equal(true);
    expect((await verify({})).status.calledWith(400)).to.equal(true);
    expect((await verify({ email: "different@example.test" })).status.calledWith(400)).to.equal(true);
    expect((await verify({ email })).status.calledWith(200)).to.equal(true);
    expect((await verify({ email })).status.calledWith(400)).to.equal(true);
  });
  it("rate limits resends and locks the code after five failed attempts", async () => {
    expect((await send({ email })).status.calledWith(200)).to.equal(true);
    expect((await send({ email })).status.calledWith(429)).to.equal(true);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await verify({ email, otp: "000000" })).status.calledWith(400)).to.equal(true);
    }
    expect((await verify({ email })).status.calledWith(429)).to.equal(true);
    expect(otpService.generateOTPForAccount.calledOnce).to.equal(true);
  });
});

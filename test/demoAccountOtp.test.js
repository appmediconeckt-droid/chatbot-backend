import { expect } from "chai";
import sinon from "sinon";
import DemoOtpConfig, { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";
import otpService from "../src/services/otpService.js";

describe("Database demo account OTP", () => {
  afterEach(() => sinon.restore());

  it("uses the DB configuration for exactly the four demo accounts", async () => {
    const lookup = sinon.stub(DemoOtpConfig, "findOne").returns({ lean: async () => ({ otp: "123456" }) });
    for (const email of DEMO_ACCOUNT_EMAILS) {
      expect(await otpService.generateOTPForAccount(` ${email.toUpperCase()} `)).to.equal("123456");
      expect(lookup.lastCall.args[0]).to.deep.equal({ email, enabled: true });
    }
  });

  it("does not query demo configuration or fix OTPs for ordinary users", async () => {
    const lookup = sinon.stub(DemoOtpConfig, "findOne");
    const random = sinon.stub(otpService, "generateOTP").returns("987654");
    expect(await otpService.generateOTPForAccount("normal@example.com")).to.equal("987654");
    expect(lookup.called).to.equal(false);
    expect(random.calledOnceWithExactly("normal@example.com")).to.equal(true);
  });

  it("falls back to the normal flow when demo configuration is disabled or invalid", async () => {
    const lookup = sinon.stub(DemoOtpConfig, "findOne");
    lookup.onFirstCall().returns({ lean: async () => null });
    lookup.onSecondCall().returns({ lean: async () => ({ otp: "999999" }) });
    sinon.stub(otpService, "generateOTP").returns("987654");
    expect(await otpService.generateOTPForAccount(DEMO_ACCOUNT_EMAILS[0])).to.equal("987654");
    expect(await otpService.generateOTPForAccount(DEMO_ACCOUNT_EMAILS[0])).to.equal("987654");
  });

  it("allows demo login, verification and password reset without a working demo inbox", async () => {
    sinon.stub(DemoOtpConfig, "findOne").returns({ lean: async () => ({ otp: "123456" }) });
    for (const send of ["sendLoginOTP", "sendEmailOTP", "sendPasswordResetOTP", "sendForgotPasswordOTP"]) {
      expect(await otpService[send](DEMO_ACCOUNT_EMAILS[0], "123456")).to.deep.equal({ success: true, provider: "demo-account" });
    }
  });
});

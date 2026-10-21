import { expect } from "chai";
import sinon from "sinon";
import DemoOtpConfig, { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";
import otpService from "../src/services/otpService.js";

describe("Permanent demo account OTP", () => {
  afterEach(() => sinon.restore());

  it("uses 123456 for exactly the four demo accounts without a database dependency", async () => {
    const lookup = sinon.stub(DemoOtpConfig, "findOne").throws(new Error("Demo configuration unavailable"));
    for (const email of DEMO_ACCOUNT_EMAILS) {
      expect(await otpService.generateOTPForAccount(` ${email.toUpperCase()} `)).to.equal("123456");
      expect(otpService.generateOTP(` ${email.toUpperCase()} `)).to.equal("123456");
    }
    expect(lookup.called).to.equal(false);
  });

  it("does not query demo configuration or fix OTPs for ordinary users", async () => {
    const lookup = sinon.stub(DemoOtpConfig, "findOne");
    const random = sinon.stub(otpService, "generateOTP").returns("987654");
    expect(await otpService.generateOTPForAccount("normal@example.com")).to.equal("987654");
    expect(lookup.called).to.equal(false);
    expect(random.calledOnceWithExactly("normal@example.com")).to.equal(true);
  });

  it("keeps the demo code stable after resends and time passes", async () => {
    const clock = sinon.useFakeTimers();
    for (const email of DEMO_ACCOUNT_EMAILS) {
      expect(await otpService.generateOTPForAccount(email)).to.equal("123456");
    }
    clock.tick(365 * 24 * 3600000);
    for (const email of DEMO_ACCOUNT_EMAILS) {
      expect(await otpService.generateOTPForAccount(email)).to.equal("123456");
    }
  });

  it("allows demo login, verification and password reset without a working demo inbox", async () => {
    for (const email of DEMO_ACCOUNT_EMAILS) {
      for (const send of ["sendLoginOTP", "sendEmailOTP", "sendPasswordResetOTP", "sendForgotPasswordOTP"]) {
        expect(await otpService[send](email, "123456")).to.deep.equal({ success: true, provider: "demo-account" });
      }
    }
  });

  it("matches complete demo email addresses only", async () => {
    for (const email of ["demo.user1@humaeli.com.attacker.test", "other-demo@humaeli.com", "", null]) {
      expect(await otpService.getDemoOTP(email)).to.equal(null);
    }
  });
});

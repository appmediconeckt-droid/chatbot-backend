import { expect } from "chai";
import sinon from "sinon";
import DemoOtpConfig, { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";
import otpService from "../src/services/otpService.js";

describe("Review login OTP purpose separation", () => {
  afterEach(() => sinon.restore());
  it("uses the fixed code only through the dedicated login generator, independent of legacy expiry", async () => {
    const lookup = sinon.stub(DemoOtpConfig, "findOne").throws(new Error("Unavailable"));
    const random = sinon.stub(otpService, "generateOTP").returns("987654");
    for (const email of DEMO_ACCOUNT_EMAILS) {
      expect(await otpService.generateLoginOTPForAccount(` ${email.toUpperCase()} `)).to.equal("123456");
      expect(await otpService.generateOTPForAccount(email)).to.equal("987654");
    }
    expect(lookup.called).to.equal(false); expect(random.callCount).to.equal(4);
  });
  it("uses random codes for all other emails including misleading suffixes", async () => {
    sinon.stub(otpService, "generateOTP").returns("987654");
    for (const email of ["normal@example.test", "demo.user1@humaeli.com.attacker.test", "", null]) {
      expect(await otpService.generateLoginOTPForAccount(email)).to.equal("987654");
      expect(await otpService.getDemoOTP(email)).to.equal(null);
    }
  });
  it("suppresses mail only for the exact review login code", async () => {
    for (const email of DEMO_ACCOUNT_EMAILS) {
      expect(await otpService.sendLoginOTP(email,"123456")).to.deep.equal({success:true,provider:"demo-account"});
    }
  });
});

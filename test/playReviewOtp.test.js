import { expect } from "chai";
import otpService, {
  APP_REVIEW_TEST_EMAILS,
} from "../src/services/otpService.js";

describe("App review OTP", () => {
  it("includes the requested demo review accounts", () => {
    expect(APP_REVIEW_TEST_EMAILS).to.include("demo.user1@humaeli.com");
    expect(APP_REVIEW_TEST_EMAILS).to.include("demo.counsellor1@humaeli.com");
  });

  it("always returns 123456 for allowlisted review emails", () => {
    for (const email of APP_REVIEW_TEST_EMAILS) {
      expect(otpService.generateOTP(email)).to.equal("123456");
      expect(otpService.generateOTP(` ${email.toUpperCase()} `)).to.equal(
        "123456",
      );
    }
  });

  it("keeps generating six-digit random OTPs for normal accounts", () => {
    const generated = new Set(
      Array.from({ length: 10 }, () =>
        otpService.generateOTP("normal.user@example.com"),
      ),
    );

    for (const otp of generated) {
      expect(otp).to.match(/^\d{6}$/);
    }
    expect(generated.size).to.be.greaterThan(1);
  });
});

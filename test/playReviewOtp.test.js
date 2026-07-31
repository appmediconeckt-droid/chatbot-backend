import { expect } from "chai";
import otpService, {
  PLAY_REVIEW_TEST_EMAILS,
} from "../src/services/otpService.js";

describe("Play Store review OTP", () => {
  it("always returns 123456 for both allowlisted review emails", () => {
    for (const email of PLAY_REVIEW_TEST_EMAILS) {
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

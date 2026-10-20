import { expect } from "chai";
import otpService from "../src/services/otpService.js";
describe("Review OTP configuration", () => {
  let saved;
  const keys = [
    "APP_REVIEW_ENABLED",
    "APP_REVIEW_OTP",
    "APP_REVIEW_EXPIRES_AT",
    "APP_REVIEW_TEST_EMAILS",
    "PLAY_REVIEW_TEST_EMAILS",
  ];
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);
  });
  afterEach(() =>
    keys.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    })
  );
  it("has no permanent review bypass by default", () => {
    expect(otpService.isPlayReviewEmail("appstore.user@humaeli.com")).to.equal(
      false
    );
  });
  it("requires enabled, expiring, explicitly allowlisted configuration", () => {
    process.env.APP_REVIEW_ENABLED = "true";
    process.env.APP_REVIEW_OTP = "394827";
    process.env.APP_REVIEW_EXPIRES_AT = new Date(
      Date.now() + 60000
    ).toISOString();
    process.env.APP_REVIEW_TEST_EMAILS = "appstore.user@humaeli.com";
    expect(otpService.generateOTP(" APPSTORE.USER@HUMAELI.COM ")).to.equal(
      "394827"
    );
    expect(otpService.isPlayReviewEmail("normal@example.com")).to.equal(false);
    process.env.APP_REVIEW_EXPIRES_AT = new Date(
      Date.now() - 1000
    ).toISOString();
    expect(otpService.isPlayReviewEmail("appstore.user@humaeli.com")).to.equal(
      false
    );
  });
  it("continues random six digit OTPs for normal accounts", () => {
    const values = new Set(
      Array.from({ length: 10 }, () =>
        otpService.generateOTP("normal@example.com")
      )
    );
    expect(values.size).to.be.greaterThan(1);
    for (const value of values) expect(value).to.match(/^\d{6}$/);
  });
});

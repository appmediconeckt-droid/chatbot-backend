import { expect } from "chai";
import otpService from "../src/services/otpService.js";
describe("Environment configuration cannot expand the fixed-code allowlist", () => {
  it("ignores arbitrary environment allowlists for ordinary and Play accounts", async () => {
    const keys=["APP_REVIEW_ENABLED","APP_REVIEW_OTP","APP_REVIEW_EXPIRES_AT","APP_REVIEW_TEST_EMAILS"];
    const saved=keys.map(k=>process.env[k]);
    try {
      process.env.APP_REVIEW_ENABLED="true"; process.env.APP_REVIEW_OTP="394827";
      process.env.APP_REVIEW_EXPIRES_AT=new Date(Date.now()+60000).toISOString();
      process.env.APP_REVIEW_TEST_EMAILS="ordinary@example.test,playstore.user@humaeli.com";
      for (const email of process.env.APP_REVIEW_TEST_EMAILS.split(",")) {
        expect(otpService.isPlayReviewEmail(email)).to.equal(false);
        expect(await otpService.getDemoOTP(email)).to.equal(null);
      }
    } finally {keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}
  });
  it("generates unpredictable six-digit codes for generic purposes", () => {
    const codes=new Set(Array.from({length:10},()=>otpService.generateOTP()));
    expect(codes.size).to.be.greaterThan(1); for(const code of codes) expect(code).to.match(/^\d{6}$/);
  });
});

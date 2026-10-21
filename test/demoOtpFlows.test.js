import { sendForgotPasswordOTP, verifyForgotPasswordOTP, resetPassword, resendForgotPasswordOTP } from "../src/controllers/forgotPasswordController.js";
import { expect } from "chai";
import sinon from "sinon";
import { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";
import { generateOtp } from "../src/utils/generateOtp.js";
import { resendOtp } from "../src/utils/resendOtp.js";
import { verifyOtp } from "../src/middleware/verifyOtp.js";
import { verifyPasswordOtp, setPasswordByOtp } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";

describe("Review accounts reject legacy passwordless and recovery bypasses", () => {
  afterEach(() => sinon.restore());
  for (const email of DEMO_ACCOUNT_EMAILS) {
    it(`${email}: requires the credential-gated login flow`, async () => {
      const query = sinon.stub(User,"findOne");
      for (const handler of [generateOtp,resendOtp,verifyOtp]) {
        const res={status:sinon.stub().returnsThis(),json:sinon.spy()};
        await handler({body:{email:` ${email.toUpperCase()} `,otp:"123456"}},res);
        expect(res.status.calledWith(401)).to.equal(true);
      }
      for (const handler of [verifyPasswordOtp,setPasswordByOtp,sendForgotPasswordOTP,verifyForgotPasswordOTP,resetPassword,resendForgotPasswordOTP]) {
        const res={status:sinon.stub().returnsThis(),json:sinon.spy()};
        await handler({body:{email:` ${email.toUpperCase()} `,otp:"123456",password:"Attacker!Password42"}},res);
        expect(res.status.calledWith(403)).to.equal(true);
      }
      expect(query.called).to.equal(false);
    });
  }
});

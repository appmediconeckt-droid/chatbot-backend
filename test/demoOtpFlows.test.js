import { expect } from "chai";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../src/models/userModel.js";
import OTP from "../src/models/otpModel.js";
import LoginOTP from "../src/models/loginOtpModel.js";
import Session from "../src/models/sessionModel.js";
import { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";
import { generateOtp } from "../src/utils/generateOtp.js";
import { resendOtp } from "../src/utils/resendOtp.js";
import {
  logoutOtherDevicesAndSendOTP, verifyLoginOTP,
  verifyPasswordOtp, setPasswordByOtp,
} from "../src/controllers/authController.js";

describe("Demo user and consultant OTP flows", () => {
  afterEach(() => sinon.restore());
  const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy(), cookie: sinon.spy() });

  for (const email of DEMO_ACCOUNT_EMAILS) {
    const account = () => ({
      _id: "100000000000000000000001", email,
      role: email.includes("counsellor") ? "counsellor" : "user",
      save: sinon.stub().resolves(),
      toJSON() { return { _id: this._id, email: this.email, role: this.role }; },
    });

    it(`${email}: sends, resends, verifies and sets a password using 123456`, async () => {
      const user = account();
      user.password = await bcrypt.hash("Existing-Demo-Password#42", 4);
      sinon.stub(User, "findOne").resolves(user);
      const remove = sinon.stub(OTP, "deleteMany").resolves({});
      let pending;
      sinon.stub(OTP, "create").callsFake(async record => { pending = record; return record; });
      sinon.stub(OTP, "findOne").callsFake(async query =>
        pending && query.userId === pending.userId && query.otp === pending.otp ? pending : null);
      const sessions = sinon.stub(Session, "updateMany").resolves({});
      for (const send of [generateOtp, resendOtp]) {
        const res = response();
        await send({ body: { email: ` ${email.toUpperCase()} ` } }, res);
        expect(res.status.calledWith(200)).to.equal(true);
        expect(pending.otp).to.equal("123456");
      }

      const wrong = response();
      await verifyPasswordOtp({ body: { email, otp: "000000" } }, wrong);
      expect(wrong.status.calledWith(400)).to.equal(true);

      const verified = response();
      await verifyPasswordOtp({ body: { email, otp: "123456" } }, verified);
      expect(verified.status.calledWith(200)).to.equal(true);

      const updated = response();
      const password = "Demo-Flow-Test#5281";
      await setPasswordByOtp({ body: { email, otp: "123456", password } }, updated);
      expect(updated.status.calledWith(200)).to.equal(true);
      expect(await bcrypt.compare(password, user.password)).to.equal(true);
      expect(user.save.calledOnce).to.equal(true);
      expect(sessions.calledOnce).to.equal(true);
      expect(remove.callCount).to.equal(3);
    });

    it(`${email}: verifies new-device login with 123456 before replacing sessions`, async () => {
      const user = account();
      sinon.stub(User, "findOne").resolves(user);
      sinon.stub(User, "findById").resolves(user);
      sinon.stub(User, "findByIdAndUpdate").resolves(user);
      let pending;
      sinon.stub(LoginOTP, "deleteMany").resolves({});
      sinon.stub(LoginOTP, "create").callsFake(async record => { pending = record; return record; });
      sinon.stub(LoginOTP, "findOne").returns({ sort: async () => pending });
      const sessions = sinon.stub(Session, "updateMany").resolves({});
      const create = sinon.stub(Session, "create").resolves({});
      sinon.stub(jwt, "sign").returns("test-session-token");
      const sent = response();
      await logoutOtherDevicesAndSendOTP({ body: { email } }, sent);
      expect(sent.status.calledWith(200)).to.equal(true);
      expect(pending.otp).to.equal("123456");
      expect(sessions.called).to.equal(false);

      const wrong = response();
      await verifyLoginOTP({ body: { email, otp: "000000" } }, wrong);
      expect(wrong.status.calledWith(400)).to.equal(true);
      expect(sessions.called).to.equal(false);
      expect(create.called).to.equal(false);

      const loggedIn = response();
      await verifyLoginOTP({ body: { email, otp: "123456" } }, loggedIn);
      expect(loggedIn.status.calledWith(200)).to.equal(true);
      expect(loggedIn.json.calledWithMatch({ success: true, role: user.role })).to.equal(true);
      expect(sessions.calledOnce).to.equal(true);
      expect(create.calledOnce).to.equal(true);
    });
  }
});

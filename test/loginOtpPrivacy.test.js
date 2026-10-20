import { expect } from "chai";
import sinon from "sinon";
import { logoutOtherDevicesAndSendOTP, verifyLoginOTP } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";
import LoginOTP from "../src/models/loginOtpModel.js";
import Session from "../src/models/sessionModel.js";
import otpService from "../src/services/otpService.js";

describe("Login OTP privacy and validation", () => {
  let sandbox;
  const email = "review@example.test";
  const code = "582716";
  const res = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });
  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => sandbox.restore());

  it("delivers and persists the OTP without putting it in logs or the response", async () => {
    sandbox.stub(User, "findOne").resolves({ _id: "100000000000000000000001" });
    sandbox.stub(otpService, "generateOTP").returns(code);
    const delivery = sandbox.stub(otpService, "sendLoginOTP").resolves({ success: true });
    sandbox.stub(LoginOTP, "deleteMany").resolves({});
    const save = sandbox.stub(LoginOTP, "create").resolves({});
    const log = sandbox.stub(console, "log");
    const response = res();
    await logoutOtherDevicesAndSendOTP({ body: { email } }, response);
    expect(response.status.calledWith(200)).to.equal(true);
    expect(delivery.calledWith(email, code)).to.equal(true);
    expect(save.firstCall.args[0].otp).to.equal(code);
    expect(JSON.stringify(log.args)).not.to.include(code);
    expect(JSON.stringify(response.json.args)).not.to.include(code);
  });

  for (const expired of [false, true]) {
    it(`rejects ${expired ? "expired" : "incorrect"} login OTPs without changing sessions`, async () => {
      sandbox.stub(LoginOTP, "findOne").returns({ sort: async () => ({
        userId: "100000000000000000000001", otp: code,
        expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)),
      }) });
      sandbox.stub(LoginOTP, "deleteMany").resolves({});
      const sessions = sandbox.stub(Session, "updateMany").resolves({});
      const create = sandbox.stub(Session, "create").resolves({});
      const response = res();
      await verifyLoginOTP({ body: { email, otp: expired ? code : "000000" } }, response);
      expect(response.status.calledWith(400)).to.equal(true);
      expect(sessions.called).to.equal(false);
      expect(create.called).to.equal(false);
    });
  }
});

import { expect } from "chai";
import sinon from "sinon";
import { logoutOtherDevicesAndSendOTP } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";
import LoginChallenge from "../src/models/loginChallengeModel.js";
import otpService from "../src/services/otpService.js";

describe("Login OTP privacy", () => {
  afterEach(()=>sinon.restore());
  it("persists a keyed hash and excludes OTPs from logs and responses", async () => {
    const email="ordinary@example.test", code="582716";
    sinon.stub(User,"findOne").resolves({_id:"100000000000000000000001",email,role:"user",isActive:true});
    sinon.stub(otpService,"generateOTP").returns(code);
    const delivery=sinon.stub(otpService,"sendLoginOTP").resolves({});
    const save=sinon.stub(LoginChallenge,"findOneAndUpdate").resolves({});
    const log=sinon.stub(console,"log");
    const res={status:sinon.stub().returnsThis(),json:sinon.spy()};
    await logoutOtherDevicesAndSendOTP({body:{email}},res);
    expect(res.status.calledWith(200)).to.equal(true);
    expect(delivery.calledWith(email,code)).to.equal(true);
    const record=save.firstCall.args[1].$set;
    expect(record).not.to.have.property("otp"); expect(record.otpHash).to.match(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.to.include(code);
    expect(JSON.stringify(log.args)).not.to.include(code);
    expect(JSON.stringify(res.json.args)).not.to.include(code);
  });
});

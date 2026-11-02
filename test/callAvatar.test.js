import { expect } from "chai";
import sinon from "sinon";
import User from "../src/models/userModel.js";
import Chat from "../src/models/Chat.js";
import Call from "../src/models/Call.js";
import Message from "../src/models/Message.js";
import { initiateCall } from "../src/controllers/callController.js";
import { videoCallController } from "../src/controllers/videoCallController.js";

describe("Patient profile image in calls", () => {
  afterEach(() => sinon.restore());
  const url = "https://api.dicebear.com/7.x/lorelei/png?seed=selected";
  const patient = {
    _id: "507f1f77bcf86cd799439011", role: "user", isActive: true,
    fullName: "Private Name", email: "private@example.com",
    anonymous: "Quiet River", profilePhoto: { url },
  };
  const counselor = { _id: "507f1f77bcf86cd799439012", role: "counsellor", fullName: "Counselor" };

  for (const callerIsPatient of [true, false]) {
    it(`shares the saved image when the patient is the ${callerIsPatient ? "caller" : "receiver"}`, async () => {
      const caller = callerIsPatient ? patient : counselor;
      const receiver = callerIsPatient ? counselor : patient;
      const query = { populate() { return this; }, then(resolve) {
        return Promise.resolve({ _id: "chat-db", userId: patient, counselorId: counselor }).then(resolve);
      } };
      sinon.stub(Chat, "findOne").returns(query);
      sinon.stub(User, "findById").returns({ select: async () => receiver });
      sinon.stub(Call, "findOne").resolves(null);
      sinon.stub(Call, "create").callsFake(async value => ({ ...value, _id: "call-db", callId: "call-1" }));
      sinon.stub(Message, "create").resolves({});
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await initiateCall({ user: caller, body: { chatId: "chat-1", callType: "audio", receiverId: receiver._id } }, res);
      expect(res.status.calledWith(201)).to.equal(true);
      const person = res.json.firstCall.args[0].call[callerIsPatient ? "caller" : "receiver"];
      expect(person.avatar).to.equal(url);
      expect(person.name).not.to.equal(patient.fullName);
    });
  }

  it("uses the profile image in video calls without revealing real name or email", async () => {
    sinon.stub(User, "findById").returns({ select: async () => patient });
    const person = await videoCallController.getUserDetails(patient._id, "user");
    expect(person.profilePhoto).to.equal(url);
    expect(person.name).to.equal(patient.anonymous);
    expect(person.fullName).to.equal(patient.anonymous);
    expect(person.email).to.equal("");
  });
});

import { expect } from "chai";
import sinon from "sinon";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import { getChats } from "../src/controllers/messageController.js";

describe("Chat participant images", () => {
  afterEach(() => sinon.restore());

  const loadChat = async (role, patientPhoto, consultantPhoto) => {
    const query = {
      populate() { return this; },
      sort: async () => [{
        _id: "chat-db-1", chatId: "chat-1", status: "accepted",
        userId: { _id: "patient-1", anonymous: "SelectedUser", profilePhoto: patientPhoto },
        counselorId: { _id: "consultant-1", fullName: "Consultant", profilePhoto: consultantPhoto },
      }],
    };
    sinon.stub(Chat, "find").returns(query);
    sinon.stub(Message, "findOne").returns({ sort: async () => null });
    sinon.stub(Message, "countDocuments").resolves(0);
    const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await getChats({ user: { _id: role === "user" ? "patient-1" : "consultant-1", role } }, res);
    expect(res.status.called).to.equal(false);
    return res.json.firstCall.args[0].chats[0].otherParty;
  };

  it("returns the patient's selected generated avatar to the consultant", async () => {
    const url = "https://api.dicebear.com/7.x/lorelei/png?seed=selected";
    const person = await loadChat("counsellor", { url }, null);
    expect(person.avatar).to.equal(url);
    expect(person.anonymousAvatarUrl).to.equal(url);
    expect(person.name).to.equal("SelectedUser");
  });

  it("keeps legacy patient photos private", async () => {
    const person = await loadChat("counsellor", { url: "https://example.com/private.jpg" }, null);
    expect(person.avatar).to.equal(null);
  });

  for (const photo of ["https://example.com/consultant.jpg", { url: "https://example.com/consultant.jpg" }]) {
    it(`returns the consultant's real photo when stored as ${typeof photo}`, async () => {
      const person = await loadChat("user", null, photo);
      expect(person.avatar).to.equal("https://example.com/consultant.jpg");
      expect(person.profilePhoto).to.equal("https://example.com/consultant.jpg");
    });
  }
});

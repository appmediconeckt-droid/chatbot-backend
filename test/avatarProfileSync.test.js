import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import User from "../src/models/userModel.js";
import Chat from "../src/models/Chat.js";
import Appointment from "../src/models/appointmentModel.js";
import { handleUserUpload } from "../src/middleware/multerConfig.js";
import { getAlluser, getUser, updateUserById } from "../src/controllers/authController.js";
import { sanitizeUserForCounselor } from "../src/utils/anonymousUser.js";

describe("Generated profile avatar synchronization", () => {
  afterEach(() => sinon.restore());

  for (const relationship of ["chat", "appointment", "unrelated"]) {
    it(`checks ${relationship} access when a counselor requests the latest user profile`, async () => {
      const url = "https://api.dicebear.com/7.x/lorelei/png?seed=latest";
      const user = {
        _id: "507f1f77bcf86cd799439011", role: "user", anonymous: "Quiet River",
        fullName: "Private Name", email: "private@example.com", profilePhoto: { url },
      };
      sinon.stub(User, "findById").resolves(user);
      sinon.stub(Chat, "exists").resolves(relationship === "chat" ? { _id: "chat" } : null);
      sinon.stub(Appointment, "exists").resolves(relationship === "appointment" ? { _id: "appointment" } : null);
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await getUser({
        params: { userId: user._id },
        user: { _id: "507f1f77bcf86cd799439012", role: "counsellor" },
      }, res);
      if (relationship === "unrelated") {
        expect(res.status.calledWith(403)).to.equal(true);
        expect(res.json.firstCall.args[0]).not.to.have.property("user");
      } else {
        expect(res.status.calledWith(200)).to.equal(true);
        const profile = res.json.firstCall.args[0].user;
        expect(profile.avatarUrl).to.equal(url);
        expect(profile.name).to.equal(user.anonymous);
        expect(profile.fullName).to.equal("");
        expect(profile.email).to.equal("");
      }
    });
  }

  it("includes the saved avatar when loading the consultant's related patients", async () => {
    const url = "https://api.dicebear.com/7.x/lorelei/png?seed=selected";
    sinon.stub(Chat, "distinct").resolves(["user-1"]);
    const select = sinon.stub().callsFake(async fields => {
      expect(fields.split(" ")).to.include("profilePhoto");
      return [{ _id: "user-1", anonymous: "SelectedUser", profilePhoto: { url } }];
    });
    sinon.stub(User, "find").returns({ select });
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await getAlluser({ user: { _id: "consultant-1" } }, res);
    expect(res.status.calledWith(200)).to.equal(true);
    expect(res.json.firstCall.args[0].users[0].avatarUrl).to.equal(url);
  });

  it("saves an AI avatar larger than the default multipart field limit and shares that exact image", async () => {
    const user = { _id: "user-1", role: "user", anonymous: "SelectedUser" };
    sinon.stub(User, "findById").resolves(user);
    let savedUser;
    sinon.stub(User, "findByIdAndUpdate").callsFake((_id, update) => ({
      select: async () => {
        savedUser = { ...user, ...update.$set };
        return savedUser;
      },
    }));
    const app = express();
    app.patch("/profile/:userId", handleUserUpload, updateUserById);
    // Image bytes are not modified by the profile save flow.
    const avatar = `data:image/png;base64,${Buffer.alloc(900000, 1).toString("base64")}`;
    const res = await request(app).patch("/profile/user-1").field("avatarUrl", avatar);
    expect(res.status).to.equal(200);
    expect(res.body.user.profilePhoto.url).to.equal(avatar);
    expect(sanitizeUserForCounselor(savedUser).avatarUrl).to.equal(res.body.user.profilePhoto.url);
  });

  it("keeps builder avatars identical between the saved profile and consultant response", async () => {
    const url = "https://api.dicebear.com/7.x/lorelei/png?seed=selected&hairColor=ff5c5c";
    const user = { _id: "user-1", role: "user", anonymous: "SelectedUser" };
    sinon.stub(User, "findById").resolves(user);
    let savedUser;
    sinon.stub(User, "findByIdAndUpdate").callsFake((_id, update) => ({
      select: async () => { savedUser = { ...user, ...update.$set }; return savedUser; },
    }));
    const app = express();
    app.patch("/profile/:userId", handleUserUpload, updateUserById);
    const res = await request(app).patch("/profile/user-1").field("avatarUrl", url);
    expect(res.status).to.equal(200);
    expect(res.body.user.profilePhoto.url).to.equal(url);
    expect(sanitizeUserForCounselor(savedUser).avatarUrl).to.equal(url);
  });
});

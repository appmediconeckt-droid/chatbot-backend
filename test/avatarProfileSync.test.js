import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import User from "../src/models/userModel.js";
import Chat from "../src/models/Chat.js";
import { handleUserUpload } from "../src/middleware/multerConfig.js";
import { getAlluser, updateUserById } from "../src/controllers/authController.js";
import { sanitizeUserForCounselor } from "../src/utils/anonymousUser.js";

describe("Generated profile avatar synchronization", () => {
  afterEach(() => sinon.restore());

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

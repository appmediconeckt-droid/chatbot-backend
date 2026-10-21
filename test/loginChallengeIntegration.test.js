import { fork } from "node:child_process";
import { expect } from "chai";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import sinon from "sinon";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import LoginChallenge from "../src/models/loginChallengeModel.js";
import { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";
import { loginUser, logoutOtherDevicesAndSendOTP, verifyLoginOTP, logout, refreshAccessToken } from "../src/controllers/authController.js";
import { issueLoginChallenge, consumeLoginChallenge, discardLoginChallenge } from "../src/services/loginChallengeService.js";
import { authRateLimit, AuthRateBucket, publicAuthPeer } from "../src/middleware/authRateLimit.js";
import otpService from "../src/services/otpService.js";
import { generateOtp } from "../src/utils/generateOtp.js";
import { verifyOtp } from "../src/middleware/verifyOtp.js";
import { resendOtp } from "../src/utils/resendOtp.js";

// Runs real MongoDB queries against a disposable database, never MONGO_URI.
describe("Isolated review authentication with real MongoDB", function () {
  this.timeout(30000);
  let originalSecrets, mongo, accounts, password = "Isolated!Password42";
  const response = () => ({ code: 200, body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, cookie() {}, clearCookie() {}, setHeader() {},
  });
  const invoke = async (handler, body, extra = {}) => {
    const res = response(); await handler({ body, cookies: {}, ...extra }, res); return res;
  };
  before(async () => {
    originalSecrets = [process.env.ACCESS_SECRET, process.env.REFRESH_SECRET];
    process.env.ACCESS_SECRET = "isolated-test-access-secret-for-review";
    process.env.REFRESH_SECRET = "isolated-test-refresh-secret-for-review";
    if (mongoose.connection.readyState) throw new Error("Refusing an existing database connection");
    mongo = await MongoMemoryServer.create({ instance: { ip: "127.0.0.1" } });
    await mongoose.connect(mongo.getUri());
    const hash = await bcrypt.hash(password, 4);
    accounts = await User.create([...DEMO_ACCOUNT_EMAILS, "ordinary@example.test"].map((email, i) => ({
      email, fullName: "Synthetic review fixture", phoneNumber: `900000000${i}`, password: hash,
      role: email.includes("counsellor") ? "counsellor" : "user", isActive: true,
      demoPaymentsEnabled: email !== "ordinary@example.test",
      qualification: "Synthetic qualification", experience: 5, location: "Synthetic location",
      locationData: { current: { type: "Point", coordinates: [0, 0] } },
    })));
    await Promise.all([User.init(), Session.init(), LoginChallenge.init(), AuthRateBucket.init()]);
  });
  afterEach(() => sinon.restore());
  after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); ["ACCESS_SECRET", "REFRESH_SECRET"].forEach((key,i) => { if (originalSecrets[i] === undefined) delete process.env[key]; else process.env[key] = originalSecrets[i]; }); });

  for (const email of DEMO_ACCOUNT_EMAILS) {
    it(`${email}: repeated password login/logout, invalid OTP, resend, duplicate consume, tokens and restart`, async () => {
      const user = accounts.find(a => a.email === email);
      const credentials = { email: ` ${email.toUpperCase()} `, password, role: user.role };
      for (let i = 0; i < 3; i++) {
        const fresh = await invoke(loginUser, credentials);
        expect(fresh.code).to.equal(200);
        const decoded = jwt.verify(fresh.body.accessToken, process.env.ACCESS_SECRET);
        expect(decoded.role).to.equal(user.role);
        expect((await invoke(loginUser, credentials)).code).to.equal(409);
        expect((await invoke(logoutOtherDevicesAndSendOTP, { email })).code).to.equal(401);
        expect((await invoke(logoutOtherDevicesAndSendOTP, { ...credentials, password: "wrong" })).code).to.equal(401);
        expect((await invoke(logoutOtherDevicesAndSendOTP, credentials)).code).to.equal(200);
        expect((await invoke(verifyLoginOTP, { ...credentials, otp: "000000" })).code).to.equal(400);
        expect((await invoke(verifyLoginOTP, { email, otp: "123456" })).code).to.equal(401);
        expect((await Session.findById(decoded.sessionId)).isActive).to.equal(true);
        // Resend and then a connection restart: challenge is database-backed.
        expect((await invoke(logoutOtherDevicesAndSendOTP, credentials)).code).to.equal(200);
        await mongoose.disconnect(); await mongoose.connect(mongo.getUri());
        const concurrent = await Promise.all(Array.from({ length: 8 }, () => invoke(verifyLoginOTP, { ...credentials, otp: "123456" })));
        expect(concurrent.filter(r => r.code === 200)).to.have.length(1);
        const session = concurrent.find(r => r.code === 200).body;
        const token = jwt.verify(session.accessToken, process.env.ACCESS_SECRET);
        expect(session.role).to.equal(user.role);
        expect(jwt.verify(session.refreshToken, process.env.REFRESH_SECRET).sessionId).to.equal(token.sessionId);
        expect(await Session.countDocuments({ userId: user._id, isActive: true })).to.equal(1);
        // App-style restoration uses the returned refresh token, retaining the role.
        const refreshed = await invoke(refreshAccessToken, { refreshToken: session.refreshToken });
        expect(refreshed.code).to.equal(200);
        expect(jwt.verify(refreshed.body.accessToken, process.env.ACCESS_SECRET).role).to.equal(user.role);
        const out = await invoke(logout, {}, { userId: user._id, sessionId: token.sessionId,
          user: { _id: user._id }, cookies: { refreshToken: refreshed.body.refreshToken || session.refreshToken } });
        expect(out.code).to.equal(200);
        expect(await Session.countDocuments({ userId: user._id, isActive: true })).to.equal(0);
      }
      await issueLoginChallenge(user, "123456");
      await LoginChallenge.updateOne({ _id: user._id }, { expiresAt: new Date(Date.now() - 1000) });
      expect(await consumeLoginChallenge(user, "123456")).to.equal(false);
      for (const handler of [generateOtp, resendOtp, verifyOtp]) {
        expect((await invoke(handler, { email, otp: "123456" })).code).to.equal(401);
      }
    });
  }
  it("does not let a failed older delivery delete a newer resend; stores only hashes", async () => {
    const user = accounts[0];
    const older = await issueLoginChallenge(user, "123456");
    await issueLoginChallenge(user, "123456"); await discardLoginChallenge(older);
    const record = await LoginChallenge.findById(user._id).lean();
    expect(record).not.to.have.property("otp"); expect(JSON.stringify(record)).not.to.include("123456");
    expect(await consumeLoginChallenge(user, "123456")).to.equal(true);
  });
  it("all four accounts: screenshot generate/verify/resend routes require credentials and use 123456", async () => {
    for (const user of accounts.slice(0,4)) {
      const credentials = { email:` ${user.email.toUpperCase()} `, password, role:user.role };
      expect((await invoke(generateOtp,credentials)).code).to.equal(200);
      expect((await invoke(verifyOtp,{...credentials,password:"wrong",otp:"123456"})).code).to.equal(401);
      expect((await invoke(verifyOtp,{...credentials,otp:"000000"})).code).to.equal(400);
      expect((await invoke(resendOtp,credentials)).code).to.equal(200);
      const results = await Promise.all(Array.from({length:6},()=>invoke(verifyOtp,{...credentials,otp:"123456"})));
      expect(results.filter(r=>r.code===200)).to.have.length(1);
      expect(results.find(r=>r.code===200).body.role).to.equal(user.role);
      await Session.updateMany({userId:user._id},{isActive:false});
    }
  });
  it("review OTP does not depend on an unrelated payment feature flag", async () => {
    const user=accounts[0]; await User.updateOne({_id:user._id},{demoPaymentsEnabled:false});
    const body={email:user.email,password,role:user.role,otp:"123456"};
    expect((await invoke(generateOtp,body)).code).to.equal(200);
    expect((await invoke(verifyOtp,body)).code).to.equal(200);
    await Session.updateMany({userId:user._id},{isActive:false});
    await User.updateOne({_id:user._id},{demoPaymentsEnabled:true});
  });
  it("limits attempts atomically and refuses role/deactivation changes", async () => {
    const user = accounts[0]; await issueLoginChallenge(user, "123456");
    await Promise.all(Array.from({length: 10}, () => consumeLoginChallenge(user, "000000")));
    expect((await LoginChallenge.findById(user._id)).attempts).to.equal(5);
    expect(await consumeLoginChallenge(user, "123456")).to.equal(false);
    await issueLoginChallenge(user, "123456");
    expect((await invoke(verifyLoginOTP, {email:user.email,password,role:"counsellor",otp:"123456"})).code).to.equal(401);
    await User.updateOne({_id:user._id},{isActive:false});
    expect((await invoke(verifyLoginOTP, {email:user.email,password,otp:"123456"})).code).to.equal(401);
    await User.updateOne({_id:user._id},{isActive:true});
  });
  it("ordinary users receive random email codes; rejects fixed/wrong/expired/replaced codes", async () => {
    const user = accounts[4]; let delivered;
    sinon.stub(otpService, "sendLoginOTP").callsFake(async (email, otp) => { delivered = otp; });
    const req = {email:user.email,role:user.role};
    expect((await invoke(logoutOtherDevicesAndSendOTP,req)).code).to.equal(200);
    expect(delivered).to.match(/^\d{6}$/);
    const first = delivered;
    const wrong = delivered === "123456" ? "000000" : "123456";
    expect((await invoke(verifyLoginOTP,{...req,otp:wrong})).code).to.equal(400);
    await invoke(logoutOtherDevicesAndSendOTP,req);
    if (delivered !== first) expect((await invoke(verifyLoginOTP,{...req,otp:first})).code).to.equal(400);
    expect((await invoke(verifyLoginOTP,{...req,otp:delivered})).code).to.equal(200);
    expect((await invoke(verifyLoginOTP,{...req,otp:delivered})).code).to.equal(400);
  });
  it("does not apply one shared IP quota to private proxy peers", () => {
    for (const ip of ["127.0.0.1","::1","10.0.0.2","100.64.1.2","172.20.1.1","192.168.1.1","::ffff:10.0.0.1","fd00::1"]) {
      expect(publicAuthPeer(ip)).to.equal(null);
    }
    expect(publicAuthPeer("8.8.8.8")).to.equal("8.8.8.8");
  });
  it("persists per-email abuse counters across reconnect and concurrent requests", async () => {
    const req = {body:{email:"rate@example.test"},ip:"127.0.0.1"};
    const run = async () => { const res = response(); await authRateLimit(req,res,()=>{}); return res.code; };
    const statuses = await Promise.all(Array.from({length:65},run));
    expect(statuses.filter(s => s === 429)).to.have.length(5);
    await mongoose.disconnect(); await mongoose.connect(mongo.getUri());
    expect(await run()).to.equal(429);
  });
  it("all four accounts: real HTTP across two processes, backend restart and expired access/session", async () => {
    const workers = new Set();
    const start = () => new Promise((resolve, reject) => {
      const child = fork(new URL("./fixtures/review-auth-worker.js", import.meta.url), [], {
        env: { ...process.env, OTP_TEST_MONGO_URI: mongo.getUri() }, stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      workers.add(child); child.once("error", reject);
      child.once("exit", code => { workers.delete(child); if(code) reject(new Error("Local worker exited")); });
      child.once("message", ({port}) => resolve({child,base:`http://127.0.0.1:${port}`}));
    });
    const stop = worker => new Promise(resolve => { worker.child.once("exit",resolve); worker.child.kill("SIGTERM"); });
    const post = async (worker,path,body,token) => {
      const res=await fetch(worker.base+"/api/auth/"+path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
      return {code:res.status,body:await res.json()};
    };
    try {
      await AuthRateBucket.deleteMany({});
      let a=await start(), b=await start();
      for(const user of accounts.slice(0,4)) {
        await Session.updateMany({userId:user._id}, {isActive:false});
        const credentials={email:user.email,password,role:user.role};
        const fresh=await post(a,"login",credentials); expect(fresh.code).to.equal(200);
        expect((await post(b,"logout-other-devices",credentials)).code).to.equal(200);
        await stop(a); a=await start();
        const results=await Promise.all(Array.from({length:6},(_,i)=>post(i%2?a:b,"verify-login-otp",{...credentials,otp:"123456"})));
        expect(results.filter(r=>r.code===200)).to.have.length(1);
        const session=results.find(r=>r.code===200).body;
        const decoded=jwt.verify(session.accessToken,process.env.ACCESS_SECRET);
        const expired=jwt.sign({userId:user._id,sessionId:decoded.sessionId,role:user.role},process.env.ACCESS_SECRET,{expiresIn:-1});
        const denied=await fetch(a.base+"/api/auth/me",{headers:{Authorization:`Bearer ${expired}`}});
        expect(denied.status).to.equal(401);
        const refreshed=await post(b,"refresh-token",{refreshToken:session.refreshToken});
        expect(refreshed.code).to.equal(200);
        const restored=await fetch(a.base+"/api/auth/me",{headers:{Authorization:`Bearer ${refreshed.body.accessToken}`}});
        expect(restored.status).to.equal(200); expect((await restored.json()).role).to.equal(user.role);
        expect((await post(a,"logout",{},refreshed.body.accessToken)).code).to.equal(200);
        const inactive=await fetch(b.base+"/api/auth/me",{headers:{Authorization:`Bearer ${refreshed.body.accessToken}`}});
        expect(inactive.status).to.equal(401);
        expect((await post(b,"login",credentials)).code).to.equal(200);
        await Session.updateMany({userId:user._id},{isActive:false});
      }
    } finally { await Promise.all([...workers].map(child=>new Promise(resolve=>{child.once("exit",resolve);child.kill("SIGTERM");}))); }
  });

});

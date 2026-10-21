import { expect } from "chai";
import sinon from "sinon";
import http from "node:http";
import https from "node:https";
import mongoose from "mongoose";
import User from "../src/models/userModel.js";
import Transaction from "../src/models/transactionModel.js";
import CounselorEarning from "../src/models/CounselorEarning.js";
import Appointment from "../src/models/appointmentModel.js";
import Notification from "../src/models/Notification.js";
import { book } from "../src/controllers/appointmentController.js";
import { chargeCallByDuration } from "../src/services/paidSessionService.js";
import { creditCapturedWalletPayment } from "../src/services/walletPaymentService.js";
import {
  createOrder,
  verifyPayment,
  reconcileWalletPayment,
  razorpayWebhook,
  requestWithdrawal,
  simulatePayment,
  getCounselorWalletData,
} from "../src/controllers/walletController.js";
const response = () => ({
  statusCode: 200,
  status(n) {
    this.statusCode = n;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
const uid = new mongoose.Types.ObjectId();
const cid = new mongoose.Types.ObjectId();
const chain = (value) => {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    limit: () => q,
    lean: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
};
describe("Demo payment isolation", () => {
  let sandbox, outgoing, realBalance, demoBalance, credits, record;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    outgoing = [
      sandbox.stub(http, "request").throws(new Error("Unexpected network")),
      sandbox.stub(https, "request").throws(new Error("Unexpected network")),
      sandbox
        .stub(globalThis, "fetch")
        .rejects(new Error("Unexpected network")),
    ];
    realBalance = 900;
    demoBalance = 0;
    credits = new Set();
    record = null;
  });
  afterEach(() => {
    outgoing.forEach((stub) =>
      expect(stub.called, "No provider requests").to.equal(false)
    );
    sandbox.restore();
  });
  const setupWallet = () => {
    sandbox
      .stub(Transaction, "findOneAndUpdate")
      .callsFake(async (_filter, update) => {
        if (!record)
          record = {
            ...update.$setOnInsert,
            _id: new mongoose.Types.ObjectId(),
            save: async () => {},
          };
        return record;
      });
    sandbox.stub(User, "updateOne").callsFake(async (filter, update) => {
      expect(update.$inc).to.have.all.keys("demoWalletBalance");
      const key = filter.demoWalletCreditIds.$ne;
      if (credits.has(key)) return { modifiedCount: 0 };
      credits.add(key);
      demoBalance += update.$inc.demoWalletBalance;
      return { modifiedCount: 1 };
    });
    sandbox
      .stub(User, "findById")
      .callsFake(() =>
        chain({ demoPaymentsEnabled: true, demoWalletBalance: demoBalance, walletBalance: realBalance })
      );
  };
  it("blocks every legacy payment and payout operation without database or provider work", async () => {
    const db = sandbox
      .stub(User, "updateOne")
      .rejects(new Error("Unexpected DB mutation"));
    for (const action of [
      createOrder,
      verifyPayment,
      reconcileWalletPayment,
      razorpayWebhook,
      requestWithdrawal,
    ]) {
      const res = response();
      await action(
        {
          body: { amount: 100, accountNumber: "123456789" },
          user: { demoPaymentsEnabled: true, _id: uid },
        },
        res
      );
      expect(res.statusCode).to.equal(403);
      expect(res.body.code).to.equal("REAL_PAYMENTS_DISABLED");
    }
    expect(db.called).to.equal(false);
    try {
      await creditCapturedWalletPayment({
        transaction: {},
        paymentId: "legacy",
      });
      expect.fail("capture must fail");
    } catch (error) {
      expect(error.code).to.equal("REAL_PAYMENTS_DISABLED");
    }
  });
  it("credits only demo funds and handles repeated/concurrent retries once", async () => {
    setupWallet();
    const req = {
      body: { amount: 100, requestId: "demo_request_001" },
      user: { demoPaymentsEnabled: true, _id: uid },
    };
    const results = [response(), response(), response()];
    await Promise.all(results.map((res) => simulatePayment(req, res)));
    expect(demoBalance).to.equal(100);
    expect(realBalance).to.equal(900);
    for (const res of results) {
      expect(res.body).to.include({
        success: true,
        paymentMode: "demo",
        status: "demo_completed",
        redeemable: false,
      });
      expect(res.body.transaction).not.to.have.property("razorpayPaymentId");
    }
    expect(credits.size).to.equal(1);
  });
  it("rejects reusing a simulation key with a different amount", async () => {
    setupWallet();
    await simulatePayment(
      {
        body: { amount: 100, requestId: "demo_request_001" },
        user: { demoPaymentsEnabled: true, _id: uid },
      },
      response()
    );
    const res = response();
    await simulatePayment(
      {
        body: { amount: 200, requestId: "demo_request_001" },
        user: { demoPaymentsEnabled: true, _id: uid },
      },
      res
    );
    expect(res.statusCode).to.equal(409);
    expect(demoBalance).to.equal(100);
  });
  it("rejects invalid simulation input before storage work", async () => {
    const db = sandbox.stub(Transaction, "findOneAndUpdate");
    for (const amount of ["invalid", Infinity, 0, -1, 1.001, 100001]) {
      const res = response();
      await simulatePayment(
        { body: { amount, requestId: "demo_request_001" }, user: { demoPaymentsEnabled: true, _id: uid } },
        res
      );
      expect(res.statusCode).to.equal(400);
    }
    expect(db.called).to.equal(false);
  });
  it("books an appointment with a linked demo transaction and no wallet debit", async () => {
    sandbox.stub(User, "findOne").returns(chain({ _id: cid }));
    sandbox.stub(User, "findById").returns(chain(null));
    const db = sandbox.stub(User, "updateOne");
    sandbox
      .stub(Notification, "create")
      .callsFake(async (value) => ({ toObject: () => value }));
    let saved;
    sandbox.stub(Transaction, "create").callsFake(async (value) => {
      saved = value;
      return { ...value, _id: new mongoose.Types.ObjectId() };
    });
    sandbox
      .stub(Appointment, "create")
      .callsFake(async (value) => ({ ...value, status: "pending" }));
    const res = response();
    await book(
      {
        user: { demoPaymentsEnabled: true, _id: uid, anonymous: "Demo User" },
        body: {
          counselorId: cid,
          date: new Date(Date.now() + 86400000).toISOString(),
          paymentMode: "demo", demoAmount: 1155,
        },
      },
      res
    );
    expect(res.statusCode).to.equal(201);
    expect(res.body).to.include({
      paymentMode: "demo",
      paymentStatus: "demo_completed",
      status: "pending",
    });
    expect(saved).to.include({
      amount: 1155,
      paymentMode: "demo",
      status: "demo_completed",
    });
    expect(String(saved.appointmentId)).to.equal(String(res.body._id));
    expect(db.called).to.equal(false);
  });
  it("exposes only demo earnings, no bank details and no withdrawable entitlement", async () => {
    const find = sandbox
      .stub(CounselorEarning, "find")
      .returns(
        chain([
          {
            earningAmount: 80,
            totalAmount: 100,
            commission: 20,
            paymentMode: "demo",
            earningStatus: "demo_completed",
            createdAt: new Date(),
          },
        ])
      );
    sandbox
      .stub(User, "findById")
      .returns(
        chain({
          demoPaymentsEnabled: true, demoWalletBalance: 80,
          walletBalance: 900,
          payoutAccount: { accountNumber: "private" },
        })
      );
    const res = response();
    await getCounselorWalletData({ user: { _id: cid }, query: {} }, res);
    expect(find.firstCall.args[0]).to.include({
      paymentMode: "demo",
      earningStatus: "demo_completed",
    });
    expect(res.body).to.include({
      balance: 80,
      totalEarned: 80,
      pendingPayout: 0,
      payoutsEnabled: false,
      redeemable: false,
      payoutAccount: null,
    });
    expect(res.body.withdrawals).to.deep.equal([]);
  });
  it("simulates call earnings in the demo ledger only", async () => {
    const user = {
      demoPaymentsEnabled: true, demoWalletBalance: 500,
      walletBalance: 900,
      save: sandbox.stub().resolves(),
    };
    sandbox
      .stub(User, "findById")
      .callsFake((id) =>
        String(id) === String(uid)
          ? Promise.resolve(user)
          : chain({ fullName: "Consultant", demoPaymentsEnabled: true })
      );
    sandbox.stub(Transaction, "findOne").resolves(null);
    const tx = sandbox
      .stub(Transaction, "create")
      .callsFake(async (value) => ({
        ...value,
        _id: new mongoose.Types.ObjectId(),
      }));
    const earn = sandbox
      .stub(CounselorEarning, "findOneAndUpdate")
      .resolves({});
    const update = sandbox.stub(User, "findByIdAndUpdate").resolves({});
    // Avoid notification provider work; failure here is swallowed by the notification service.
    sandbox
      .stub(Notification, "create")
      .rejects(new Error("Notifications unavailable in fixture"));
    await chargeCallByDuration({
      userId: uid,
      counselorId: cid,
      callId: "demo-call",
      sessionType: "voice",
      durationSeconds: 60,
    });
    expect(user.walletBalance).to.equal(900);
    expect(user.demoWalletBalance).to.be.lessThan(500);
    expect(tx.firstCall.args[0]).to.include({
      paymentMode: "demo",
      status: "demo_completed",
    });
    expect(earn.firstCall.args[1].$setOnInsert).to.include({
      paymentMode: "demo",
      earningStatus: "demo_completed",
      payoutStatus: "demo_unavailable",
    });
    expect(update.firstCall.args[1].$inc).to.have.property("demoWalletBalance");
    expect(update.firstCall.args[1].$inc).not.to.have.property("walletBalance");
  });
});

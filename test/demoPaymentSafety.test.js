import { expect } from "chai";
import sinon from "sinon";
import { createOrder } from "../src/controllers/walletController.js";
describe("Demo checkout safety", () => {
  let key;
  beforeEach(() => {
    key = process.env.RAZORPAY_KEY_ID;
  });
  afterEach(() => {
    if (key === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = key;
  });
  it("rejects demo requests against live credentials before creating an order", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_test_fixture";
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await createOrder(
      { body: { amount: 100, demoOnly: true }, user: { _id: "demo" } },
      res
    );
    expect(res.status.calledWith(503)).to.equal(true);
    expect(
      res.json.calledWithMatch({ code: "DEMO_PAYMENTS_UNAVAILABLE" })
    ).to.equal(true);
  });
  it("rejects non-finite and fractional-paise amounts before provider work", async () => {
    for (const amount of ["invalid", Infinity, 0, -1, 1.001]) {
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await createOrder({ body: { amount }, user: { _id: "demo" } }, res);
      expect(res.status.calledWith(400)).to.equal(true);
    }
  });
});

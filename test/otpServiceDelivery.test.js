import { expect } from "chai";
import sinon from "sinon";
import nodemailer from "nodemailer";

const ENV_KEYS = [
  "BREVO_API_KEY",
  "EMAIL_FROM",
  "HUMAELI_EMAIL_FROM",
  "VERIFIED_EMAIL_FROM",
  "EMAIL_USER",
  "EMAIL",
  "EMAIL_PASSWORD",
  "GMAIL_APP_PASSWORD",
  "GMAIL_FROM_EMAIL",
  "UNVERIFIED_BREVO_SENDERS",
  "ALLOW_UNVERIFIED_BREVO_SENDER",
];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const restoreEnv = () => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
};

const importFreshOtpService = async () =>
  import(`../src/services/otpService.js?test=${Date.now()}-${Math.random()}`);

describe("OTP mail delivery", () => {
  afterEach(() => {
    restoreEnv();
    sinon.restore();
    delete global.fetch;
  });

  it("uses the configured Brevo sender when it is not explicitly marked unverified", async () => {
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.OTP_EMAIL_PROVIDER = "brevo";
    process.env.EMAIL_FROM = "info@humaeli.com";
    process.env.HUMAELI_EMAIL_FROM = "info@humaeli.com";
    process.env.EMAIL_USER = "info@humaeli.com";
    process.env.EMAIL = "info@humaeli.com";
    process.env.EMAIL_PASSWORD = "app-password";
    process.env.UNVERIFIED_BREVO_SENDERS = "";
    process.env.ALLOW_UNVERIFIED_BREVO_SENDER = "false";

    const fetchStub = sinon.stub().resolves({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ messageId: "brevo-msg-1" }),
    });
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP("User.Name@gmail.com", "123456");

    expect(result.provider).to.equal("brevo");
    expect(fetchStub.calledOnce).to.equal(true);

    const requestBody = JSON.parse(fetchStub.firstCall.args[1].body);
    expect(requestBody.sender.email).to.equal("info@humaeli.com");
    expect(requestBody.to[0].email).to.equal("User.Name@gmail.com");
  });

  it("uses Gmail SMTP as the primary OTP sender when Gmail credentials are configured", async () => {
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@humaeli.com";
    process.env.EMAIL_USER = "info@humaeli.com";
    process.env.EMAIL = "info@humaeli.com";
    process.env.EMAIL_PASSWORD = "app-password";
    delete process.env.OTP_EMAIL_PROVIDER;

    const sendMailStub = sinon.stub().resolves({ messageId: "gmail-msg-primary" });
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });
    const fetchStub = sinon.stub();
    global.fetch = fetchStub;

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendEmailOTP("person@gmail.com", "654321");

    expect(result.provider).to.equal("gmail");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(sendMailStub.calledOnce).to.equal(true);
    expect(fetchStub.called).to.equal(false);
  });

  it("falls back to Brevo when Gmail SMTP fails", async () => {
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "info@humaeli.com";
    process.env.EMAIL_USER = "info@humaeli.com";
    process.env.EMAIL = "info@humaeli.com";
    process.env.EMAIL_PASSWORD = "app-password";
    delete process.env.OTP_EMAIL_PROVIDER;

    const sendMailStub = sinon.stub().rejects(new Error("Invalid login"));
    const createTransportStub = sinon
      .stub(nodemailer, "createTransport")
      .returns({ sendMail: sendMailStub });

    global.fetch = sinon.stub().resolves({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ messageId: "brevo-msg-fallback" }),
    });

    const { default: otpService } = await importFreshOtpService();
    const result = await otpService.sendLoginOTP("person@gmail.com", "654321");

    expect(result.provider).to.equal("brevo");
    expect(createTransportStub.calledOnce).to.equal(true);
    expect(sendMailStub.calledOnce).to.equal(true);
    expect(global.fetch.calledOnce).to.equal(true);
  });
});

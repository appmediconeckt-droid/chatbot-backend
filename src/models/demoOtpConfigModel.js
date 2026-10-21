import mongoose from "mongoose";

// Permanent demo credentials are restricted to these four accounts.
export const DEMO_ACCOUNT_EMAILS = Object.freeze([
  "demo.user1@humaeli.com",
  "appstore.user@humaeli.com",
  "demo.counsellor1@humaeli.com",
  "appstore.counsellor@humaeli.com",
]);

const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, enum: DEMO_ACCOUNT_EMAILS },
  enabled: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  otp: { type: String, required: true, enum: ["123456"] },
}, { timestamps: true });

export default mongoose.models.DemoOtpConfig || mongoose.model("DemoOtpConfig", schema);

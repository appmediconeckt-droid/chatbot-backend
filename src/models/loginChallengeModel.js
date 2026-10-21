import mongoose from "mongoose";

// A new collection prevents legacy plaintext/duplicate records from being accepted.
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  email: { type: String, required: true },
  role: { type: String, required: true },
  nonce: { type: String, required: true },
  otpHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  consumedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model("LoginChallenge", schema);

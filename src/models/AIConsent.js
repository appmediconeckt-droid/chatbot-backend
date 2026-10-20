import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    provider: { type: String, default: "OpenAI", enum: ["OpenAI"] },
    consentVersion: String,
    consentGranted: { type: Boolean, default: false },
    consentedAt: Date,
    revokedAt: Date,
    lockUntil: { type: Date, default: () => new Date(0) },
    lockToken: String,
    activeCalls: { type: [String], default: [] },
    rateWindowAt: Date,
    rateCount: { type: Number, default: 0 },
    events: [{ _id: false, version: String, granted: Boolean, at: Date }],
  },
  { timestamps: true }
);
schema.index({ userId: 1, provider: 1 }, { unique: true });
export default mongoose.model("AIConsent", schema);

import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    reason: {
      type: String,
      enum: ["harassment", "inappropriate_content", "spam", "safety_concern"],
      required: true,
    },
    details: { type: String, maxlength: 2000, default: "" },
    status: {
      type: String,
      enum: ["open", "reviewing", "resolved"],
      default: "open",
    },
  },
  { timestamps: true }
);
schema.index({ status: 1, createdAt: 1 });
export default mongoose.models.AbuseReport ||
  mongoose.model("AbuseReport", schema);

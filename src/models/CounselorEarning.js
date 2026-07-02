import mongoose from "mongoose";

const counselorEarningSchema = new mongoose.Schema(
  {
    counselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatSession",
      required: true,
      unique: true,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    sessionType: {
      type: String,
      enum: ["chat", "voice", "video"],
      default: "chat",
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    commission: {
      type: Number,
      default: 0,
    },
    earningAmount: {
      type: Number,
      required: true,
    },
    payoutStatus: {
      type: String,
      enum: ["pending", "approved", "paid", "rejected"],
      default: "pending",
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

const CounselorEarning =
  mongoose.models.CounselorEarning ||
  mongoose.model("CounselorEarning", counselorEarningSchema);

export default CounselorEarning;

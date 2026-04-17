import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional for guest/landing page chats
    },
    userMessage: String,
    aiResponse: String,
  },
  { timestamps: true },
);

export default mongoose.models.AIChat || mongoose.model("AIChat", chatSchema);

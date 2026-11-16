import mongoose from "mongoose";
const schema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", index: true },
  // Bound by the prescription workflow or a reviewed historical migration.
  // Never accepted from upload input.
  prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription" },
  purpose: { type: String, enum: ["chat", "certification", "prescription"], required: true },
  name: { type: String, required: true },
  mimeType: { type: String, required: true },
  data: { type: Buffer, required: true, select: false },
  size: { type: Number, required: true },
}, { timestamps: true });
export default mongoose.model("PrivateAsset", schema);

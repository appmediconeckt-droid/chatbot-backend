// mindCrawller/src/models/appointmentModel.js
import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    paymentMode: { type: String, enum: ["demo", "free"], default: "free" },
    paymentStatus: { type: String, enum: ["demo_completed", "not_required"], default: "not_required" },
    paymentTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    counselor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
      validate: {
        // Protect every creation path, not only the HTTP controller. Existing
        // appointments can still be updated after their scheduled time.
        validator(value) {
          return !this.isNew || value.getTime() > Date.now();
        },
        message: "Appointment date and time must be in the future",
      },
    },
    // optional extra fields
    notes: { type: String },
    status: {
      type: String,
      enum: ["pending", "confirmed", "canceled", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Appointment", appointmentSchema);

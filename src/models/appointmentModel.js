// mindCrawller/src/models/appointmentModel.js
import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    requestKey: { type: String },
    requestHash: { type: String },
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
  { timestamps: true, autoIndex: process.env.NODE_ENV !== "production" },
);

// Exact start-time reservations only. Duration/overlap rules require product approval.
appointmentSchema.index({ counselor: 1, date: 1 }, { name: "active_counselor_start", unique: true, partialFilterExpression: { status: { $in: ["pending", "confirmed"] } } });
appointmentSchema.index({ patient: 1, date: 1 }, { name: "active_patient_start", unique: true, partialFilterExpression: { status: { $in: ["pending", "confirmed"] } } });
appointmentSchema.index({ patient: 1, requestKey: 1 }, { name: "booking_request_key", unique: true, partialFilterExpression: { requestKey: { $type: "string" } } });

export default mongoose.model("Appointment", appointmentSchema);

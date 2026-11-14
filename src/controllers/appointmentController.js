import { ensureBookingIndexes } from "../services/ensureBookingIndexes.js";
import { createHash } from "node:crypto";
// mindCrawller/src/controllers/appointmentController.js
import mongoose from "mongoose";
import Appointment from "../models/appointmentModel.js";
import User from "../models/userModel.js";
import { createNotificationSafely } from "../services/notificationService.js";
import {
  getAnonymousUserName,
  sanitizeUserForCounselor,
} from "../utils/anonymousUser.js";

// Delete appointments that never became a completed/confirmed session once
// their scheduled date/time is past. Support both American and British
// cancellation spellings because older clients store both variants.
const EXPIRED_UNRESOLVED_STATUS_PATTERN =
  /^(pending|rejected|reject|canceled|cancelled)$/i;

// Pending/rejected/canceled appointments are no longer actionable once their
// scheduled time has passed. deleteMany is idempotent, so it is safe to run
// from both the recurring cleanup job and the appointments API request path.
export const deleteExpiredUnresolvedAppointments = async () => {
  const result = await Appointment.deleteMany({
    // Existing records can contain "reject" / uppercase values from older
    // UI versions, so keep this check case-insensitive and backward-safe.
    status: EXPIRED_UNRESOLVED_STATUS_PATTERN,
    date: { $lt: new Date() },
  });

  if (result.deletedCount > 0) {
    console.log(
      `Appointment cleanup: removed ${result.deletedCount} expired unresolved appointment(s)`
    );
  }

  return result.deletedCount;
};

// IST (India Standard Time) is UTC+5:30
const IST_OFFSET = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds

// Convert any date to IST
const toIST = (date) => {
  const utcDate = new Date(date);
  return new Date(utcDate.getTime() + IST_OFFSET);
};

// Get start of day in IST
const getStartOfDayIST = (date) => {
  const istDate = toIST(date);
  const startOfDay = new Date(istDate);
  startOfDay.setHours(0, 0, 0, 0);
  return new Date(startOfDay.getTime() - IST_OFFSET); // Convert back to UTC
};

// Get end of day in IST
const getEndOfDayIST = (date) => {
  const istDate = toIST(date);
  const endOfDay = new Date(istDate);
  endOfDay.setHours(23, 59, 59, 999);
  return new Date(endOfDay.getTime() - IST_OFFSET); // Convert back to UTC
};

export const book = async (req, res) => {
  try {
    const { counselorId, date, notes } = req.body || {};

    // Basic validation
    if (!counselorId || !date) {
      return res
        .status(400)
        .json({ message: "counselorId and date are required" });
    }

    if (!mongoose.isValidObjectId(counselorId)) return res.status(400).json({ message: "Invalid counselor ID" });
    const appointmentDate = new Date(date);
    if (Number.isNaN(appointmentDate.getTime())) {
      return res.status(400).json({ message: "Invalid appointment date" });
    }
    if (appointmentDate.getTime() <= Date.now()) {
      return res.status(400).json({
        message: "Appointment date and time must be in the future",
      });
    }

    const counselor = await User.findOne({
      _id: counselorId,
      role: "counsellor",
      isActive: true,
      profileCompleted: true,
    }).select("_id");

    if (!counselor) {
      return res.status(404).json({
        message: "Counselor not found or profile is not complete yet",
      });
    }

    // All appointment bookings are free, including legacy/demo clients.
    // Supplied amounts/payment flags never create a charge or ledger record.
    const appointmentId = new mongoose.Types.ObjectId();
    const requestKey = req.get?.("Idempotency-Key") || req.body.requestId;
    if (requestKey && !/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey)) return res.status(400).json({ message: "Invalid booking request key" });
    const requestHash = createHash("sha256").update(JSON.stringify([String(counselorId), appointmentDate.toISOString(), notes || "", false, 0])).digest("hex");
    // Production disables Mongoose autoIndex. Build missing constraints before
    // accepting a write; never drop conflicting indexes or repair patient data.
    try {
      await ensureBookingIndexes(Appointment.collection);
    } catch (error) {
      console.warn("Appointment index setup unavailable", { code: error.code || "INDEX_SETUP_FAILED", blockers: error.blockers });
      return res.status(503).json({ code: "BOOKING_SETUP_REQUIRED", message: "Booking is temporarily unavailable. Please try again shortly." });
    }
    if (requestKey) {
      const existing = await Appointment.findOne({ patient: req.user._id, requestKey });
      if (existing) return existing.requestHash === requestHash ? res.status(200).json(existing) : res.status(409).json({ code: "IDEMPOTENCY_CONFLICT", message: "This request key was used for another booking" });
    }
    let appointment;
    try {
      // A free booking changes one document. Unique indexes provide atomic
      // reservation/idempotency protection without requiring replica-set transactions.
      appointment = await Appointment.create({
        _id: appointmentId, paymentMode: "free", paymentStatus: "not_required",
        paymentTransactionId: null, patient: req.user._id,
        counselor: counselorId, date: appointmentDate, notes,
        ...(requestKey ? { requestKey, requestHash } : {}),
      });
    } catch (error) {
      if (error.code === 11000) {
        const previous = requestKey ? await Appointment.findOne({ patient: req.user._id, requestKey }) : await Appointment.findOne({ patient: req.user._id, counselor: counselorId, date: appointmentDate, status: { $in: ["pending", "confirmed"] } });
        if (previous && (!requestKey || previous.requestHash === requestHash)) return res.status(200).json(previous);
        return res.status(409).json({ code: "SLOT_UNAVAILABLE", message: "This appointment time is no longer available" });
      }
      throw error;
    }

    // Notify the counselor via socket if global.io exists
    if (global.io) {
      const targetRooms = [
        `user_${counselorId}`,
        `counsellor_${counselorId}`,
        `counselor_${counselorId}`,
      ];
      targetRooms.forEach((room) => {
        global.io.to(room).emit("appointmentBooked", appointment);
      });
    }

    await createNotificationSafely({
      recipientId: counselorId,
      actorId: req.user._id,
      type: "appointment",
      title: "New appointment request",
      message: `${getAnonymousUserName(
        req.user
      )} requested an appointment for ${new Date(date).toLocaleString(
        "en-IN"
      )}.`,
      data: {
        appointmentId: appointment._id,
        status: appointment.status,
        date,
      },
      actionUrl: "/counselor/appointments",
    });

    return res.status(201).json(appointment);
  } catch (err) {
    console.error("Booking could not be committed");
    return res.status(503).json({ message: "Booking could not be confirmed. Retry with the same request key." });
  }
};

export const getAppointments = async (req, res) => {
  try {
    await deleteExpiredUnresolvedAppointments();

    const userId = req.user._id;
    const { filter, date } = req.query;

    let dateFilter = {};
    const now = new Date();

    // ✅ DATE-WISE FILTER (NEW) - WITH IST TIMEZONE
    if (date) {
      const selectedDate = new Date(date);
      const startOfDay = getStartOfDayIST(selectedDate);
      const endOfDay = getEndOfDayIST(selectedDate);

      dateFilter = {
        date: { $gte: startOfDay, $lte: endOfDay },
      };
    }

    // ✅ EXISTING FILTERS - WITH IST TIMEZONE
    else if (filter === "today") {
      const startOfDay = getStartOfDayIST(now);
      const endOfDay = getEndOfDayIST(now);

      dateFilter = {
        date: { $gte: startOfDay, $lte: endOfDay },
      };
    } else if (filter === "last7days") {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfDay = getStartOfDayIST(sevenDaysAgo);

      dateFilter = {
        date: { $gte: startOfDay, $lte: getEndOfDayIST(now) },
      };
    }

    const query = Appointment.find({
      $or: [{ patient: userId }, { counselor: userId }],
      ...dateFilter,
    });
    if (req.user.role === "counsellor") query.select("+sessionNote");
    const appointments = await query
      .populate("patient", "fullName profilePhoto anonymous")
      .populate("counselor", "fullName profilePhoto anonymous")
      .sort({ date: -1 })
      .lean();

    if (req.user.role === "counsellor") {
      return res.json(
        appointments.map((appointment) => ({
          ...appointment,
          sessionNote: String(appointment.counselor?._id || appointment.counselor) === String(userId)
            ? appointment.sessionNote : undefined,
          patient: sanitizeUserForCounselor(
            appointment.patient,
            appointment.patient?._id || appointment.patient
          ),
        }))
      );
    }

    return res.json(appointments);
  } catch (err) {
    console.error("❌ get appointments error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateSessionNote = async (req, res) => {
  if (req.user?.role !== "counsellor") return res.status(403).json({ message: "Only consultants can save session notes" });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid appointment ID" });
  const note = req.body?.sessionNote;
  if (typeof note !== "string" || !note.trim() || note.length > 5000) {
    return res.status(400).json({ message: "Enter a session note between 1 and 5000 characters" });
  }
  try {
    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, counselor: req.user._id },
      { $set: { sessionNote: note.trim() } },
      { returnDocument: "after", runValidators: true },
    ).select("_id +sessionNote");
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    return res.json({ appointment: { _id: appointment._id, sessionNote: appointment.sessionNote } });
  } catch {
    return res.status(500).json({ message: "Unable to save session notes. Please try again." });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const requestedStatus = String(req.body.status || "").toLowerCase();
    const status = requestedStatus === "cancelled" ? "canceled" : requestedStatus;
    if (!["pending", "confirmed", "canceled", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid appointment status" });
    if (req.user.role === "user" && status !== "canceled") return res.status(403).json({ message: "Users may only cancel their own appointments" });
    const userId = req.user._id;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Basic authorization: user must be either patient or counselor
    if (
      appointment.patient.toString() !== userId.toString() &&
      appointment.counselor.toString() !== userId.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const transitions = { pending: ["confirmed", "rejected", "canceled"], confirmed: ["canceled"], canceled: [], rejected: [] };
    if (appointment.status !== status && !transitions[appointment.status]?.includes(status)) {
      return res.status(409).json({ message: "Appointment status changed. Refresh before trying again." });
    }
    if (status === "canceled" && new Date(appointment.date).getTime() <= Date.now()) {
      return res.status(400).json({ message: "A past appointment cannot be canceled" });
    }
    if (
      String(status).toLowerCase() === "confirmed" &&
      new Date(appointment.date).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        message: "A past appointment cannot be confirmed or booked",
      });
    }

    const updated = await Appointment.findOneAndUpdate({ _id: appointment._id, status: appointment.status }, { $set: { status } }, { returnDocument: "after", runValidators: true });
    if (!updated) return res.status(409).json({ message: "Appointment changed. Refresh before trying again." });
    appointment.status = updated.status;

    await createNotificationSafely({
      recipientId: String(userId) === String(appointment.patient) ? appointment.counselor : appointment.patient,
      actorId: req.user._id,
      type: "appointment",
      title: `Appointment ${status}`,
      message: `Your appointment request has been ${status}.`,
      data: { appointmentId: appointment._id, status, date: appointment.date },
      actionUrl: "/appointments",
    });

    return res.json({
      message: `Appointment ${status} successfully`,
      appointment,
    });
  } catch (err) {
    console.error("❌ update status error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

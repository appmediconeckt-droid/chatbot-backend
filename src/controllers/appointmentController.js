// mindCrawller/src/controllers/appointmentController.js
import Transaction from "../models/transactionModel.js";
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
    const { counselorId, date, notes } = req.body;

    // Basic validation
    if (!counselorId || !date) {
      return res
        .status(400)
        .json({ message: "counselorId and date are required" });
    }

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

    const demoAmount = Number(req.body.demoAmount || 0);
    if (
      !Number.isFinite(demoAmount) ||
      demoAmount < 0 ||
      demoAmount > 100000 ||
      Math.abs(demoAmount * 100 - Math.round(demoAmount * 100)) > 0.000001
    ) {
      return res
        .status(400)
        .json({ message: "Invalid simulated appointment amount" });
    }
    const appointmentId = new mongoose.Types.ObjectId();
    if (req.body.paymentMode === "demo" && req.user.demoPaymentsEnabled !== true) {
      return res.status(403).json({ code: "DEMO_SIMULATION_DISABLED", message: "Demo simulation is not enabled for this account" });
    }
    const simulation = req.user.demoPaymentsEnabled === true && req.body.paymentMode === "demo";
    const transaction = simulation ? await Transaction.create({
      userId: req.user._id,
      counselorId,
      appointmentId,
      amount: demoAmount,
      paymentMode: "demo",
      status: "demo_completed",
      type: "debit",
      description:
        "Demo appointment payment — no charge or monetary entitlement",
      metadata: { simulationOnly: true, redeemable: false },
    }) : null;
    let appointment;
    try {
      appointment = await Appointment.create({
        _id: appointmentId,
        paymentMode: simulation ? "demo" : "free",
        paymentStatus: simulation ? "demo_completed" : "not_required",
        paymentTransactionId: transaction?._id || null,
        patient: req.user._id, // `auth` middleware puts the logged‑in user on req.user
        counselor: counselorId,
        date: appointmentDate,
        notes,
      });
    } catch (error) {
      if (transaction) await Transaction.deleteOne({ _id: transaction._id });
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
    console.error("❌ book appointment error", err);
    return res.status(500).json({ message: "Server error" });
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

    const appointments = await Appointment.find({
      $or: [{ patient: userId }, { counselor: userId }],
      ...dateFilter,
    })
      .populate("patient", "fullName profilePhoto anonymous")
      .populate("counselor", "fullName profilePhoto anonymous")
      .sort({ date: -1 })
      .lean();

    if (req.user.role === "counsellor") {
      return res.json(
        appointments.map((appointment) => ({
          ...appointment,
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

    appointment.status = status;
    await appointment.save();

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

// mindCrawller/src/controllers/appointmentController.js
import Appointment from "../models/appointmentModel.js";

export const book = async (req, res) => {
  try {
    const { counselorId, date, notes } = req.body;

    // Basic validation
    if (!counselorId || !date) {
      return res
        .status(400)
        .json({ message: "counselorId and date are required" });
    }

    const appointment = await Appointment.create({
      patient: req.user._id, // `auth` middleware puts the logged‑in user on req.user
      counselor: counselorId,
      date,
      notes,
    });

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

    return res.status(201).json(appointment);
  } catch (err) {
    console.error("❌ book appointment error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getAppointments = async (req, res) => {
  try {
    const userId = req.user._id;
    // Find appointments where the user is either the patient or the counselor

    const appointments = await Appointment.find({
      $or: [{ patient: userId }, { counselor: userId }],
    })
      .populate("patient", "fullName profilePhoto anonymous")
      .populate("counselor", "fullName profilePhoto anonymous")
      .sort({ date: -1 });

    return res.json(appointments);
  } catch (err) {
    console.error("❌ get appointments error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user._id;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Basic authorization: user must be either patient or counselor
    if (
      appointment.patient.toString() !== userId &&
      appointment.counselor.toString() !== userId
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    appointment.status = status;
    await appointment.save();

    return res.json({
      message: `Appointment ${status} successfully`,
      appointment,
    });
  } catch (err) {
    console.error("❌ update status error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

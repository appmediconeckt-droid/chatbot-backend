import express from "express";
const router = express.Router();
import * as appointmentCtrl from "../controllers/appointmentController.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";

// Users can book appointments
router.post("/", authenticateToken, authorizeRoles("user"), appointmentCtrl.book);

// Both can see their appointments
router.get("/", authenticateToken, appointmentCtrl.getAppointments);

// Counsellors can update appointment status
router.patch("/:id/status", authenticateToken, authorizeRoles("counsellor"), appointmentCtrl.updateStatus);

export default router;

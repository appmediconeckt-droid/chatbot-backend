import express from "express";
const router = express.Router();
import * as appointmentCtrl from "../controllers/appointmentController.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";
import { requireUnblockedInteraction } from "../services/interactionSafety.js";

// Users can book appointments
router.post("/", authenticateToken, authorizeRoles("user"), requireUnblockedInteraction, appointmentCtrl.book);

// Both can see their appointments
router.get("/", authenticateToken, appointmentCtrl.getAppointments);

// Counsellors can update appointment status
router.patch("/:id/status", authenticateToken, authorizeRoles("user", "counsellor"), appointmentCtrl.updateStatus);

export default router;

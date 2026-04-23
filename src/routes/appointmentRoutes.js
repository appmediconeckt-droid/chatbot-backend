// mindCrawller/src/routes/appointmentRoutes.js
import express from "express";
const router = express.Router();
import * as appointmentCtrl from "../controllers/appointmentController.js";
import { authenticateToken } from "../middleware/auth.js";

router.post("/", authenticateToken, appointmentCtrl.book);
router.get("/", authenticateToken, appointmentCtrl.getAppointments);
router.patch("/:id/status", authenticateToken, appointmentCtrl.updateStatus);

export default router;

import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireAIConsent } from "../services/aiConsent.js";
import { chatWithAI } from "../controllers/chatController.js";
import realtimeRoutes from "./aiRealtimeRoute.js";
const router = express.Router();
router.use("/realtime", realtimeRoutes);
// Keep the legacy path on the same disclosed, authenticated AI implementation.
router.post("/message", authMiddleware, requireAIConsent, chatWithAI);
export default router;

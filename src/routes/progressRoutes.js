import express from "express";
import {
  getUserMoodJourney,
  getMoodProgressReport,
  getCrisisHistory,
  getConversationSummary,
} from "../controllers/progressController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get user's mood journey and insights
router.get("/mood-journey", getUserMoodJourney);

// Get mood progress report
router.get("/mood-report", getMoodProgressReport);

// Get crisis history
router.get("/crisis-history", getCrisisHistory);

// Get conversation summary
router.get("/conversation-summary", getConversationSummary);

export default router;

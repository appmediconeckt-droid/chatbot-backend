import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import {
  submitRatingV2,
  checkEligibility,
  remindLater,
  neverAskAgain,
} from "../controllers/ratingController.js";

const router = express.Router();

// Mounted at /api/ratings — eligibility-driven rating flow.
router.post("/submit", authenticateToken, submitRatingV2);
router.get("/check-eligibility", authenticateToken, checkEligibility);
router.post("/remind-later", authenticateToken, remindLater);
router.post("/never-ask-again", authenticateToken, neverAskAgain);

export default router;

import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import {
  submitRating,
  getCounselorRatings,
} from "../controllers/ratingController.js";

const router = express.Router();

// Mounted at /api/counselors
router.post("/:counselorId/ratings", authenticateToken, submitRating);
router.get("/:counselorId/ratings", authenticateToken, getCounselorRatings);

export default router;

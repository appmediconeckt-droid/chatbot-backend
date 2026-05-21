import express from "express";
import { authMiddleware, adminOnly } from "../middleware/authMiddleware.js";
import {
  updateLocation,
  getChatLocations,
  adminAllLocations,
  adminPendingCounsellors,
  adminGetLocationHistory,
  adminVerifyLocation,
} from "../controllers/locationController.js";

const router = express.Router();

// Logged-in user / counsellor — save their current GPS
router.post("/update", authMiddleware, updateLocation);

// Logged-in user / counsellor — fetch both participant locations in a chat
router.get("/chat/:chatId", authMiddleware, getChatLocations);

// Admin — every user + counsellor with a location (for the map)
router.get("/admin/all", authMiddleware, adminOnly, adminAllLocations);

// Admin — pending verification queue
router.get("/admin/pending", authMiddleware, adminOnly, adminPendingCounsellors);

// Admin — location history (optional: ?event=login)
router.get("/admin/:userId/history", authMiddleware, adminOnly, adminGetLocationHistory);

// Admin — approve / reject location verification
router.post("/admin/:userId/verify", authMiddleware, adminOnly, adminVerifyLocation);

export default router;

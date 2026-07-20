import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import {
  deleteNotification,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from "../controllers/notificationController.js";

const router = express.Router();

router.get("/", authenticateToken, getNotifications);
router.get("/unread-count", authenticateToken, getUnreadCount);
router.patch("/read-all", authenticateToken, markAllAsRead);
router.patch("/:id/read", authenticateToken, markAsRead);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;

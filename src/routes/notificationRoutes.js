import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import {
  deleteNotification,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  saveFCMToken,
} from "../controllers/notificationController.js";
import { testNotification } from "../controllers/pushNotificationController.js";

const router = express.Router();

router.get("/", authenticateToken, getNotifications);
router.get("/unread-count", authenticateToken, getUnreadCount);
router.put("/token", authenticateToken, saveFCMToken);
router.post("/test", authenticateToken, testNotification);
router.patch("/read-all", authenticateToken, markAllAsRead);
router.patch("/:id/read", authenticateToken, markAsRead);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;

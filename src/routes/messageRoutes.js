
// export default router;
import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { uploadChatAttachment } from "../middleware/multerConfig.js";
import {
  getChats,
  startChat,
  acceptChat,
  rejectChat,
  getPendingRequests,
  getChatMessages,
  sendMessage,
  deleteChat,
  clearChat,
  markAllRead,
  getUnreadCount,
  getCounselors,
  getCounselorDetails,
  updateStatus,
  searchCounselors,
} from "../controllers/messageController.js";

const router = express.Router();

// ==================== CHAT REQUEST ROUTES ====================
router.post("/start", authenticateToken, startChat);
router.patch("/accept/:chatId", authenticateToken, acceptChat);
router.patch("/reject/:chatId", authenticateToken, rejectChat);
router.get("/pending-requests", authenticateToken, getPendingRequests);

// ==================== CHAT MANAGEMENT ROUTES ====================
router.get("/chats", authenticateToken, getChats);
router.get("/chat/:chatId/messages", authenticateToken, getChatMessages);
router.post(
  "/chat/:chatId/message",
  authenticateToken,
  uploadChatAttachment,
  sendMessage,
);
router.delete("/chat/:chatId", authenticateToken, deleteChat);
router.delete("/clear/:chatId", authenticateToken, clearChat);
router.post("/mark-all-read", authenticateToken, markAllRead);
router.get("/unread-count", authenticateToken, getUnreadCount);

// ==================== COUNSELOR ROUTES ====================
router.get("/counselors", authenticateToken, getCounselors);
router.get("/counselor/:counselorId", authenticateToken, getCounselorDetails);
router.patch("/status", authenticateToken, updateStatus);
router.get("/search/counselors", authenticateToken, searchCounselors);

// Get all counsellors from database

export default router;

import { randomUUID } from "node:crypto";
import { requireAIConsent } from "../services/aiConsent.js";
import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
  chatWithAI,
  textToSpeech,
  textToSpeechGet,
  getMyChatHistory,
  clearMyChatHistory,
  deleteMyChatMessage,
  devClearChatsForUserId,
  devResetProfileFields,
} from "../controllers/chatController.js";

const router = express.Router();

router.post("/send-message", authMiddleware, requireAIConsent, chatWithAI);
router.post("/tts", authMiddleware, requireAIConsent, textToSpeech);
router.get("/tts", authMiddleware, requireAIConsent, textToSpeechGet);
router.post("/start-session", authMiddleware, (req, res) =>
  res.json({ success: true, data: { sessionId: randomUUID() } })
);
router.get("/history/:userId", authMiddleware, (req, res, next) => {
  if (String(req.user._id) !== req.params.userId)
    return res.status(403).json({ success: false, message: "Forbidden" });
  return getMyChatHistory(req, res, next);
});
router.get("/history", authMiddleware, getMyChatHistory);
// User-triggered: wipe the caller's own chat history so onboarding can
// trigger fresh. Auth required — users can only clear their OWN messages.
router.delete("/my-history", authMiddleware, clearMyChatHistory);
router.delete("/message/:chatId", authMiddleware, deleteMyChatMessage);

// DEV-ONLY: clear chats for any userId without auth. Only mounts when
// NODE_ENV !== "production" so production users are never exposed.
if (process.env.NODE_ENV !== "production") {
  router.delete("/_dev/clear-by-id/:userId", devClearChatsForUserId);
  // Wipe age/gender/chatContext fields that were auto-set by the chat
  // extractor — useful when test data poisoned the user's profile.
  router.post("/_dev/reset-profile/:userId", devResetProfileFields);
}

export default router;

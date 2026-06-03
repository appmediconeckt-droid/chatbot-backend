import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
  chatWithAI,
  textToSpeech,
  clearMyChatHistory,
  devClearChatsForUserId,
  devResetProfileFields,
} from "../controllers/chatController.js";

const router = express.Router();

router.post("/send-message", optionalAuth, chatWithAI);
router.post("/tts", optionalAuth, textToSpeech);
// User-triggered: wipe the caller's own chat history so onboarding can
// trigger fresh. Auth required — users can only clear their OWN messages.
router.delete("/my-history", authMiddleware, clearMyChatHistory);

// DEV-ONLY: clear chats for any userId without auth. Only mounts when
// NODE_ENV !== "production" so production users are never exposed.
if (process.env.NODE_ENV !== "production") {
  router.delete("/_dev/clear-by-id/:userId", devClearChatsForUserId);
  // Wipe age/gender/chatContext fields that were auto-set by the chat
  // extractor — useful when test data poisoned the user's profile.
  router.post("/_dev/reset-profile/:userId", devResetProfileFields);
}

export default router;
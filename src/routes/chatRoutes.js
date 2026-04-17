import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import { chatWithAI } from "../controllers/chatController.js";

const router = express.Router();

router.post("/", optionalAuth, chatWithAI);

export default router;
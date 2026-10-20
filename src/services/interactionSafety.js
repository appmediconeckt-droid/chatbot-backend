import mongoose from "mongoose";
import UserBlock from "../models/UserBlock.js";
import Chat from "../models/Chat.js";

export async function interactionIsBlocked(first, second) {
  const a = first?._id || first,
    b = second?._id || second;
  if (!a || !b) return false;
  return Boolean(
    await UserBlock.exists({
      enabled: true,
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    })
  );
}
export async function resolveSafetyChat(identifier) {
  return mongoose.isValidObjectId(identifier)
    ? Chat.findOne({ $or: [{ _id: identifier }, { chatId: identifier }] })
    : Chat.findOne({ chatId: identifier });
}
export const requireUnblockedInteraction = async (req, res, next) => {
  try {
    let first = req.user._id,
      second = req.body?.receiverId || req.body?.counselorId;
    if (req.params.chatId) {
      const chat = await resolveSafetyChat(req.params.chatId);
      if (!chat) return res.status(404).json({ error: "Chat not found" });
      if (
        ![chat.userId, chat.counselorId].some(
          (id) => String(id) === String(first)
        )
      )
        return res.status(403).json({ error: "Access denied" });
      second =
        String(chat.userId) === String(first) ? chat.counselorId : chat.userId;
    }
    if (second && !mongoose.isValidObjectId(second))
      return res.status(400).json({ error: "Invalid account ID" });
    if (await interactionIsBlocked(first, second))
      return res
        .status(403)
        .json({
          error: "This interaction is blocked",
          code: "INTERACTION_BLOCKED",
        });
    next();
  } catch {
    res
      .status(503)
      .json({ error: "Unable to check safety settings. Please retry." });
  }
};

import express from "express";
import UserBlock from "../models/UserBlock.js";
import AbuseReport from "../models/AbuseReport.js";
import Message from "../models/Message.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";
import { resolveSafetyChat } from "../services/interactionSafety.js";
import { stopTimedChatUsage } from "../services/paidSessionService.js";
const router = express.Router();
router.use(["/safety", "/moderation"], authenticateToken);
router.get("/moderation/reports", authorizeRoles("admin"), async (req, res) => {
  try {
    res.json({
      reports: await AbuseReport.find({ status: { $ne: "resolved" } })
        .sort({ createdAt: 1 })
        .limit(100)
        .lean(),
    });
  } catch {
    res.status(503).json({ error: "Unable to read reports" });
  }
});
router.get(
  "/moderation/reports/:id",
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const report = await AbuseReport.findById(req.params.id).lean();
      if (!report) return res.status(404).json({ error: "Report not found" });
      const messages = await Message.find({ chatId: report.chatId })
        .sort({ createdAt: -1 })
        .limit(50)
        .select(
          "messageId senderId senderRole content contentType attachmentUrl createdAt moderationHidden"
        )
        .lean();
      res.set("Cache-Control", "no-store").json({ report, messages });
    } catch {
      res.status(503).json({ error: "Unable to review report" });
    }
  }
);
router.patch(
  "/moderation/reports/:id/messages/:messageId",
  authorizeRoles("admin"),
  async (req, res) => {
    if (typeof req.body?.hidden !== "boolean")
      return res
        .status(400)
        .json({ error: "Choose whether to hide the message" });
    try {
      const report = await AbuseReport.findById(req.params.id).lean();
      if (!report) return res.status(404).json({ error: "Report not found" });
      const message = await Message.findOneAndUpdate(
        { _id: req.params.messageId, chatId: report.chatId },
        { $set: { moderationHidden: req.body.hidden } },
        { new: true }
      );
      if (!message)
        return res
          .status(404)
          .json({ error: "Message not found in the reported conversation" });
      if (req.body.hidden && global.io) {
        for (const userId of [report.reporterId, report.reportedId])
          global.io
            .to(`user_${userId}`)
            .emit("message-deleted", {
              chatId: String(report.chatId),
              messageId: String(message._id),
              publicMessageId: message.messageId,
              deletedForUserId: String(userId),
            });
      }
      res.json({ success: true, hidden: req.body.hidden });
    } catch {
      res.status(503).json({ error: "Unable to update moderation visibility" });
    }
  }
);
router.patch(
  "/moderation/reports/:id",
  authorizeRoles("admin"),
  async (req, res) => {
    if (!["reviewing", "resolved"].includes(req.body?.status))
      return res.status(400).json({ error: "Invalid status" });
    try {
      const report = await AbuseReport.findByIdAndUpdate(
        req.params.id,
        { $set: { status: req.body.status } },
        { new: true }
      );
      if (!report) return res.status(404).json({ error: "Report not found" });
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: "Unable to update report" });
    }
  }
);
router.use("/safety/:chatId", async (req, res, next) => {
  try {
    const chat = await resolveSafetyChat(req.params.chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    const id = String(req.user._id);
    if (![chat.userId, chat.counselorId].some((value) => String(value) === id))
      return res.status(403).json({ error: "Access denied" });
    req.safetyChat = chat;
    req.safetyTarget =
      String(chat.userId) === id ? chat.counselorId : chat.userId;
    next();
  } catch {
    res.status(503).json({ error: "Unable to read safety settings" });
  }
});
router.get("/safety/:chatId", async (req, res) => {
  try {
    res.json({
      blocked: Boolean(
        await UserBlock.exists({
          blockerId: req.user._id,
          blockedId: req.safetyTarget,
          enabled: true,
        })
      ),
    });
  } catch {
    res.status(503).json({ error: "Unable to read safety settings" });
  }
});
router.put("/safety/:chatId/block", async (req, res) => {
  if (typeof req.body?.blocked !== "boolean")
    return res.status(400).json({ error: "Choose block or unblock" });
  try {
    await UserBlock.updateOne(
      { blockerId: req.user._id, blockedId: req.safetyTarget },
      { $set: { enabled: req.body.blocked } },
      { upsert: true, runValidators: true }
    );
    if (req.body.blocked) await stopTimedChatUsage(req.safetyChat);
    res.json({ success: true, blocked: req.body.blocked });
  } catch {
    res
      .status(503)
      .json({ error: "Unable to confirm safety settings. Please retry." });
  }
});
router.post("/safety/:chatId/report", async (req, res) => {
  if (
    !["harassment", "inappropriate_content", "spam", "safety_concern"].includes(
      req.body?.reason
    ) ||
    typeof (req.body?.details ?? "") !== "string" ||
    (req.body?.details || "").length > 2000
  )
    return res
      .status(400)
      .json({ error: "Choose a report reason and up to 2000 characters" });
  try {
    if (
      (await AbuseReport.countDocuments({
        reporterId: req.user._id,
        createdAt: { $gte: new Date(Date.now() - 3600000) },
      })) >= 10
    )
      return res.status(429).json({
        error:
          "Too many reports. Contact support@humaeli.com for urgent concerns.",
      });
    const report = await AbuseReport.create({
      reporterId: req.user._id,
      reportedId: req.safetyTarget,
      chatId: req.safetyChat._id,
      reason: req.body.reason,
      details: req.body.details || "",
    });
    res.status(201).json({
      success: true,
      reportId: report._id,
      message: "Report submitted for review. You can also block this account.",
    });
  } catch {
    res.status(503).json({
      error:
        "Unable to submit report. Please retry or contact support@humaeli.com.",
    });
  }
});
export default router;

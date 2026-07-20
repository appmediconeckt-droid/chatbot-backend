import mongoose from "mongoose";
import Notification from "../models/Notification.js";

export const getNotifications = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { recipientId: req.user._id };
  if (req.query.type) filter.type = req.query.type;
  if (req.query.unread === "true") filter.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .populate("actorId", "fullName profilePhoto role")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientId: req.user._id, isRead: false }),
  ]);

  res.json({
    success: true,
    notifications,
    unreadCount,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

export const getUnreadCount = async (req, res) => {
  const unreadCount = await Notification.countDocuments({
    recipientId: req.user._id,
    isRead: false,
  });
  res.json({ success: true, unreadCount });
};

export const markAsRead = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid notification id" });
  }
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { isRead: true, readAt: new Date() },
    { new: true },
  );
  if (!notification) return res.status(404).json({ message: "Notification not found" });
  res.json({ success: true, notification });
};

export const markAllAsRead = async (req, res) => {
  const result = await Notification.updateMany(
    { recipientId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() },
  );
  res.json({ success: true, updatedCount: result.modifiedCount });
};

export const deleteNotification = async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipientId: req.user._id,
  });
  if (!notification) return res.status(404).json({ message: "Notification not found" });
  res.json({ success: true });
};

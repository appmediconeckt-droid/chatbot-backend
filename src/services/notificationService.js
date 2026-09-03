import Notification from "../models/Notification.js";
import User from "../models/userModel.js";
import { sendPushNotification } from "./pushNotificationService.js";

const enabledNotificationTypes = new Set([
  "appointment",
  "payment",
  "message",
  "call",
  "system",
]);

const notificationTypeToPushType = {
  appointment: "APPOINTMENT",
  payment: "PAYMENT",
  message: "CHAT_MESSAGE",
  call: "INCOMING_CALL",
  system: "SYSTEM",
};

export const createNotification = async ({
  recipientId,
  actorId = null,
  type,
  title,
  message,
  data = {},
  actionUrl = "",
}) => {
  if (!recipientId) return null;
  if (!enabledNotificationTypes.has(type)) return null;

  const notification = await Notification.create({
    recipientId,
    actorId,
    type,
    title,
    message,
    data,
    actionUrl,
  });

  const payload = notification.toObject();
  if (global.io) {
    const recipient = String(recipientId);
    const rooms = [
      `user_${recipient}`,
      `counsellor_${recipient}`,
      `counselor_${recipient}`,
    ];
    rooms.forEach((room) => global.io.to(room).emit("notification:new", payload));
  }

  try {
    const recipient = await User.findById(recipientId)
      .select("fcmToken role")
      .lean();

    if (recipient?.fcmToken) {
      const pushData = {
        type: data?.type || notificationTypeToPushType[type] || String(type).toUpperCase(),
        notificationId: String(notification._id),
        recipientId: String(recipientId),
        recipientRole: recipient.role || "",
        title,
        body: message,
        ...data,
      };

      await sendPushNotification({
        token: recipient.fcmToken,
        title,
        body: message,
        data: pushData,
      });
    }
  } catch (error) {
    console.error("Push delivery failed:", error.message);
  }

  return notification;
};

// Notifications must never make the main message/payment/booking request fail.
export const createNotificationSafely = async (payload) => {
  try {
    return await createNotification(payload);
  } catch (error) {
    console.error("Notification creation failed:", error.message);
    return null;
  }
};

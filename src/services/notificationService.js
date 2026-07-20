import Notification from "../models/Notification.js";

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

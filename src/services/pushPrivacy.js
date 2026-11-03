// Push providers and lock screens do not need clinical or conversation content.
// Android presentation is retained; iOS and legacy devices with no platform use
// opaque routing identifiers. Fetch actual content after authenticated app open.
const routingKeys = new Set([
  "type", "notificationType", "event", "notificationId", "recipientId", "recipientRole",
  "chatId", "publicChatId", "mongoChatId", "chatMongoId", "chatDbId", "conversationId",
  "callId", "call_id", "callerId", "receiverId", "senderId", "userId", "counselorId",
  "appointmentId", "callType", "senderRole", "role", "presentation", "presentAs", "notificationOnly",
]);
export const privatePushContent = ({ platform, title, body, data = {} }) => {
  if (platform === "android") return { title, body, data };
  const safeData = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
    routingKeys.has(key) && ["string", "number", "boolean"].includes(typeof value)));
  return { title: "Humaeli", body: "Open Humaeli to view a new update.", data: safeData };
};

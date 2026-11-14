import User from "../models/userModel.js";
import { sendPushNotification } from "../services/pushNotificationService.js";

// Diagnostic delivery can only target this authenticated account's registered device.
export const testNotification = async (req, res) => {
  try {
    const rawToken = req.body?.fcmToken || req.body?.token;
    if (typeof rawToken !== "string" || !rawToken.trim() || rawToken.length > 4096) {
      return res.status(400).json({ success: false, message: "Valid FCM token is required" });
    }
    const token = rawToken.trim();
    const owner = await User.exists({ _id: req.user._id, isActive: true, fcmToken: token });
    if (!owner) return res.status(403).json({ success: false, message: "Device is not registered to this account" });
    await sendPushNotification({ token, platform: req.body?.platform === "android" ? "android" : "ios", title: "Humaeli", body: "Backend push notification is working!", data: { type: "test" } });
    return res.status(200).json({ success: true, message: "Notification sent successfully" });
  } catch {
    return res.status(503).json({ success: false, message: "Notification delivery is unavailable" });
  }
};

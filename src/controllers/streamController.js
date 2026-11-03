import Call from "../models/Call.js";
import { createStreamCallToken, ensureStreamUser } from "../services/streamService.js";
import { interactionIsBlocked } from "../services/interactionSafety.js";

export const getStreamToken = async (req, res) => {
  try {
    const filter = { $or: [{ callerId: req.user._id }, { receiverId: req.user._id }], status: "active", isActive: true, acceptedAt: { $ne: null } };
    if (req.query.callId) filter.callId = String(req.query.callId);
    const calls = await Call.find(filter).limit(20);
    const allowed = [];
    for (const call of calls) {
      if (!await interactionIsBlocked(call.callerId, call.receiverId)) allowed.push(call.callId.replace(/^(default|room|call):/i, "").trim());
    }
    if (!allowed.length) return res.status(403).json({ success: false, error: "An accepted authorized call is required" });
    const userId = await ensureStreamUser(req.user);
    res.set("Cache-Control", "no-store").json({ success: true, token: createStreamCallToken(userId, allowed), userId, apiKey: process.env.STREAM_API_KEY || process.env.STEAM_API_KEY });
  } catch { res.status(503).json({ success: false, error: "Unable to authorize calling. Please retry." }); }
};

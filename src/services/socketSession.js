import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import { accountDeletionPending } from "./accountDeletionService.js";

export async function socketSessionIsValid(socket) {
  if (!socket.sessionId || !Number.isFinite(socket.tokenExpiresAt) || socket.tokenExpiresAt <= Date.now() / 1000) return false;
  const session = await Session.exists({ _id: socket.sessionId, userId: socket.userId, isActive: true });
  const account = await User.findById(socket.userId);
  return Boolean(session && account?.isActive && account.role === socket.userRole && !await accountDeletionPending(socket.userId));
}

export function installSocketSessionValidation(socket) {
  const validate = async () => {
    try { if (await socketSessionIsValid(socket)) return true; } catch { /* fail closed */ }
    socket.disconnect(true);
    return false;
  };
  socket.use(async (_packet, next) => {
    if (await validate()) next();
    else next(new Error("AUTH_SESSION_INACTIVE"));
  });
  // Idle sockets must also lose room subscriptions after revocation; an
  // incoming-packet check alone would still allow receiving private broadcasts.
  const interval = setInterval(() => { void validate(); }, 5000);
  interval.unref();
  const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(2147483647, socket.tokenExpiresAt * 1000 - Date.now())));
  expiry.unref();
  socket.once("disconnect", () => { clearInterval(interval); clearTimeout(expiry); });
}

import path from "node:path";
import Message from "../models/Message.js";
import Chat from "../models/Chat.js";
import { interactionIsBlocked } from "./interactionSafety.js";

export function safeLegacyFilePath(value) {
  try {
    const pathname = decodeURIComponent(new URL(value, "https://local.invalid").pathname);
    if (!pathname.startsWith("/uploads/") || pathname.includes("\\") || pathname.includes("\0")) return null;
    if (pathname.split("/").some(part => part === ".." || part === "." || part.startsWith("."))) return null;
    return pathname;
  } catch { return null; }
}

export async function canReadLegacyFile(filePath, account) {
  const owned = [account.prescriptionSignature?.url, account.prescriptionSeal?.url,
    ...(account.certifications || []).map(item => item.documentUrl)].some(value => safeLegacyFilePath(value) === filePath);
  if (owned) return true;
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const messages = await Message.find({ attachmentUrl: { $regex: `${escaped}$` }, moderationHidden: { $ne: true }, deletedFor: { $ne: account._id } }).limit(20);
  for (const message of messages) {
    if (safeLegacyFilePath(message.attachmentUrl) !== filePath) continue;
    const chat = await Chat.findById(message.chatId);
    if (chat && [chat.userId, chat.counselorId].some(id => String(id) === String(account._id)) && !await interactionIsBlocked(chat.userId, chat.counselorId)) return true;
  }
  return false;
}

export function localLegacyFile(root, filePath) {
  const relative = filePath.slice("/uploads/".length);
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null;
}

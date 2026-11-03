import mongoose from "mongoose";
import PrivateAsset from "../models/PrivateAsset.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Prescription from "../models/Prescription.js";
import { interactionIsBlocked, resolveSafetyChat } from "./interactionSafety.js";

// Treat the client's MIME as a claim. Active HTML/SVG is never accepted.
export function validateUploadContent(file) {
  const b = file.buffer;
  const type = String(file.mimetype).toLowerCase();
  if (!Buffer.isBuffer(b) || !b.length || b.length > 10 * 1024 * 1024) throw new Error("Invalid file size");
  const hex = b.subarray(0, 16).toString("hex");
  const ascii = b.subarray(0, 16).toString("latin1");
  const tests = {
    "image/jpeg": () => hex.startsWith("ffd8ff"),
    "image/png": () => hex.startsWith("89504e470d0a1a0a"),
    "image/gif": () => /^GIF8[79]a/.test(ascii),
    "image/webp": () => ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP",
    "application/pdf": () => ascii.startsWith("%PDF-"),
    "application/msword": () => hex.startsWith("d0cf11e0a1b11ae1"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": () => hex.startsWith("504b0304") && b.includes(Buffer.from("[Content_Types].xml")) && b.includes(Buffer.from("word/")),
    "text/plain": () => !b.includes(0) && !/<\s*(?:html|script|svg|iframe)|<!doctype\s+html/i.test(b.toString("utf8")),
    "audio/mpeg": () => ascii.startsWith("ID3") || (b[0] === 255 && (b[1] & 224) === 224),
    "audio/wav": () => ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE",
    "audio/x-wav": () => ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE",
    "video/mp4": () => ascii.slice(4, 8) === "ftyp",
    "video/quicktime": () => ascii.slice(4, 8) === "ftyp",
  };
  if (!tests[type]?.()) throw new Error("File contents do not match a supported file type");
  return type;
}

export async function authorizeChatUpload(req, res, next) {
  try {
    const chat = await resolveSafetyChat(req.params.chatId);
    if (!chat || ![chat.userId, chat.counselorId].some(id => String(id) === String(req.user._id))) return res.status(403).json({ error: "Access denied" });
    if (!["pending", "accepted", "active"].includes(chat.status)) return res.status(409).json({ error: "Chat is not available for uploads" });
    if (await interactionIsBlocked(chat.userId, chat.counselorId)) return res.status(403).json({ error: "Interaction blocked" });
    req.uploadChat = chat;
    next();
  } catch { res.status(503).json({ error: "Unable to authorize upload" }); }
}

export async function storePrivateAsset(req, file, purpose) {
  const mimeType = validateUploadContent(file);
  const asset = await PrivateAsset.create({ ownerId: req.user._id, chatId: req.uploadChat?._id, purpose,
    name: String(file.originalname || "attachment").replace(/[\r\n\x00-\x1f]/g, "").slice(0, 200), mimeType, data: file.buffer, size: file.buffer.length });
  return { ...file, path: `/api/private-files/${asset._id}`, filename: `private:${asset._id}`, privateAssetId: asset._id };
}

export async function canReadPrivateAsset(asset, user) {
  if (asset.prescriptionId) {
    if (asset.purpose !== "prescription") return false;
    const record = await Prescription.findById(asset.prescriptionId);
    if (!record || String(record.psychiatristId) !== String(asset.ownerId)) return false;
    const path = `/api/private-files/${asset._id}`;
    // A detached snapshot never becomes an uploader-owned orphan. PDF bytes
    // retain their existing prescription route and identity-verification gate.
    if (![record.psychiatristSnapshot?.prescriptionSignature, record.psychiatristSnapshot?.prescriptionSeal].includes(path)) return false;
    const issuer = user.role === "counsellor" && String(record.psychiatristId) === String(user._id);
    const patient = user.role === "user" && String(record.patientId) === String(user._id) && record.identityVerification?.status === "verified";
    return issuer || patient;
  }
  if (asset.purpose !== "chat") return String(asset.ownerId) === String(user._id) || user.role === "admin";
  const chat = await Chat.findById(asset.chatId);
  if (!chat || ![chat.userId, chat.counselorId].some(id => String(id) === String(user._id))) return false;
  if (await interactionIsBlocked(chat.userId, chat.counselorId)) return false;
  // A storage orphan is not an authorization grant. New chat uploads are
  // returned only after their message is saved. Hard-deleting that message
  // must not accidentally reopen the asset as an uploader-owned orphan.
  const message = await Message.findOne({ attachmentUrl: `/api/private-files/${asset._id}`, chatId: { $in: [asset.chatId, String(asset.chatId), chat.chatId] } });
  if (!message) return false;
  return !message.moderationHidden && !(message.deletedFor || []).some(id => String(id) === String(user._id));
}

export const privateAssetId = value => {
  const match = String(value || "").match(/^\/api\/private-files\/([a-f\d]{24})$/i);
  return match && mongoose.isValidObjectId(match[1]) ? match[1] : null;
};

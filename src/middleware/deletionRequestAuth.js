import { accountDeletionResponse, processAccountDeletionJob } from "../services/accountDeletionService.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Session from "../models/sessionModel.js";
import AccountDeletionJob from "../models/AccountDeletionJob.js";
import { authMiddleware } from "./authMiddleware.js";

// A lost 202 response must be retryable after account access is revoked.
// This narrow path only returns an existing job; it grants no account access.
export async function deletionRequestAuth(req, res, next) {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const claims = jwt.verify(token, process.env.ACCESS_SECRET, { algorithms: ["HS256"] });
    if (!mongoose.isValidObjectId(claims.userId) || !mongoose.isValidObjectId(claims.sessionId)) return res.status(401).json({ success: false, code: "AUTHENTICATION_REQUIRED" });
    const job = await AccountDeletionJob.findById(claims.userId);
    if (!job) return authMiddleware(req, res, next);
    const originalSession = await Session.exists({ _id: claims.sessionId, userId: claims.userId });
    if (!originalSession && !job.requestSessionIds?.some(id => String(id) === String(claims.sessionId))) return res.status(401).json({ success: false, code: "AUTHENTICATION_REQUIRED" });
    await processAccountDeletionJob(new Date(), job._id);
    const result = accountDeletionResponse(await AccountDeletionJob.findById(job._id));
    return res.set("Cache-Control", "no-store").status(result.statusCode).json(result.body);
  } catch (error) {
    if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)) return res.status(401).json({ success: false, code: "AUTHENTICATION_REQUIRED" });
    return res.status(503).json({ error: "Deletion request status is unavailable. Contact support@humaeli.com." });
  }
}

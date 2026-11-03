import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import Session from "../models/sessionModel.js";
import User from "../models/userModel.js";
import { accountDeletionPending } from "./accountDeletionService.js";

// Purpose-derived signing key prevents download capabilities being accepted
// by any legacy API middleware as account access JWTs.
const key = () => createHmac("sha256", process.env.ACCESS_SECRET || process.env.JWT_SECRET).update("humaeli-private-file-v1").digest();
export const createFileTicket = (claims, audience) => jwt.sign(claims, key(), { algorithm: "HS256", audience, expiresIn: 60 });
export async function fileTicketAccount(ticket, audience) {
  const claims = jwt.verify(ticket, key(), { algorithms: ["HS256"], audience });
  const session = await Session.exists({ _id: claims.sessionId, userId: claims.userId, isActive: true });
  const user = await User.findById(claims.userId);
  if (!session || !user?.isActive || await accountDeletionPending(user._id)) throw new Error("File authorization expired");
  return { claims, user };
}

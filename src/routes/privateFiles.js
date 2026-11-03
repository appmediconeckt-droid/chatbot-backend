import { createFileTicket, fileTicketAccount } from "../services/privateFileTickets.js";
import { safeLegacyFilePath, canReadLegacyFile } from "../services/legacyPrivateFiles.js";
import express from "express";
import mongoose from "mongoose";
import PrivateAsset from "../models/PrivateAsset.js";
import { authenticateToken } from "../middleware/auth.js";
import { canReadPrivateAsset } from "../services/privateAssets.js";
const router = express.Router();
router.get("/legacy-link", authenticateToken, async (req, res) => {
  try {
    const filePath = safeLegacyFilePath(req.query.path);
    if (!filePath || !await canReadLegacyFile(filePath, req.user)) return res.sendStatus(404);
    const ticket = createFileTicket({ path: filePath, userId: String(req.user._id), sessionId: String(req.user.sessionId) }, "legacy-private-file");
    res.set("Cache-Control", "no-store").json({ url: `${filePath}?ticket=${ticket}` });
  } catch { res.status(503).json({ error: "File is unavailable" }); }
});

router.get("/:id/link", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
    const asset = await PrivateAsset.findById(req.params.id);
    if (!asset || !await canReadPrivateAsset(asset, req.user)) return res.sendStatus(404);
    const ticket = createFileTicket({ assetId: String(asset._id), userId: String(req.user._id), sessionId: String(req.user.sessionId) }, "private-file");
    res.set("Cache-Control", "no-store").json({ url: `/api/private-files/${asset._id}?ticket=${ticket}` });
  } catch { res.status(503).json({ error: "File is unavailable" }); }
});

const readAuth = async (req, res, next) => {
  if (!req.query.ticket) return authenticateToken(req, res, next);
  try {
    const { claims, user } = await fileTicketAccount(req.query.ticket, "private-file");
    if (claims.assetId !== req.params.id) return res.sendStatus(403);
    req.user = user;
    next();
  } catch { res.sendStatus(401); }
};

router.get("/:id", readAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
    const asset = await PrivateAsset.findById(req.params.id).select("+data");
    if (!asset || !await canReadPrivateAsset(asset, req.user)) return res.sendStatus(404);
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Type": asset.mimeType });
    res.attachment(asset.name).send(asset.data);
  } catch { res.status(503).json({ error: "File is unavailable" }); }
});
export default router;

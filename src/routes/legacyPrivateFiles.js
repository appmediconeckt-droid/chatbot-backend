import express from "express";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { fileTicketAccount } from "../services/privateFileTickets.js";
import { safeLegacyFilePath, canReadLegacyFile, localLegacyFile } from "../services/legacyPrivateFiles.js";
const root = fileURLToPath(new URL("../../uploads/", import.meta.url));
const router = express.Router();
router.use(async (req, res, next) => {
  if (!req.query.ticket) return authMiddleware(req, res, next);
  try {
    const { claims, user } = await fileTicketAccount(req.query.ticket, "legacy-private-file");
    if (claims.path !== `/uploads${req.path}`) return res.sendStatus(403);
    req.user = user; next();
  } catch { res.sendStatus(401); }
});
router.use(async (req, res) => {
  try {
    const filePath = safeLegacyFilePath(`/uploads${req.path}`);
    if (!filePath || !await canReadLegacyFile(filePath, req.user)) return res.sendStatus(404);
    const resolved = localLegacyFile(root, filePath);
    if (!resolved) return res.sendStatus(404);
    // Deny symlinks escaping the private upload root as well as traversal.
    const [actual, actualRoot] = await Promise.all([realpath(resolved), realpath(root)]);
    if (!actual.startsWith(`${actualRoot}${path.sep}`)) return res.sendStatus(404);
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; sandbox" });
    res.download(actual, path.basename(actual));
  } catch { res.sendStatus(404); }
});
export default router;

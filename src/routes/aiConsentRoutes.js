import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import AIConsent from "../models/AIConsent.js";
import {
  CONSENT_VERSION,
  consentState,
  readConsent,
  withConsentLock,
  hangupCall,
  revokeConsent,
} from "../services/aiConsent.js";
const router = express.Router();
router.use(authMiddleware);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.get("/", async (req, res) => {
  try {
    res.json(consentState(await readConsent(req.user._id)));
  } catch {
    res
      .status(503)
      .json({
        success: false,
        message: "Unable to read AI consent. Please retry.",
      });
  }
});
router.post("/", async (req, res) => {
  if (
    req.body?.accepted !== true ||
    req.body?.consentVersion !== CONSENT_VERSION
  )
    return res
      .status(400)
      .json({
        success: false,
        code: "AI_CONSENT_VERSION_INVALID",
        message: "Explicit acceptance of the current disclosure is required.",
      });
  try {
    const state = await withConsentLock(req.user._id, async (current) => {
      // Clean up calls left by a previous failed withdrawal before re-enabling.
      await Promise.all((current.activeCalls || []).map(hangupCall));
      const now = new Date();
      return AIConsent.findByIdAndUpdate(
        current._id,
        {
          $set: {
            consentVersion: CONSENT_VERSION,
            consentGranted: true,
            consentedAt: now,
            revokedAt: null,
            activeCalls: [],
          },
          $push: {
            events: {
              $each: [{ version: CONSENT_VERSION, granted: true, at: now }],
              $slice: -100,
            },
          },
        },
        { new: true }
      );
    });
    res.json(consentState(state));
  } catch {
    res
      .status(503)
      .json({
        success: false,
        message: "Unable to save AI consent. Please retry.",
      });
  }
});
router.delete("/", async (req, res) => {
  try {
    const state = await revokeConsent(req.user._id);
    res.json(consentState(state));
  } catch {
    res
      .status(503)
      .json({
        success: false,
        message:
          "Withdrawal could not be fully confirmed. Please retry; active calls may still need to be stopped.",
      });
  }
});
export default router;

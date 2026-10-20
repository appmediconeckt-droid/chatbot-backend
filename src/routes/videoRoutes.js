// videoCallRoutes.js
import express from "express";
import { videoCallController } from "../controllers/videoCallController.js";
import { getStreamToken } from "../controllers/streamController.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireUnblockedInteraction } from "../services/interactionSafety.js";

const router = express.Router();
router.use(authenticateToken);
router.use((req, res, next) => {
  const suppliedIds = [req.body?.userId, req.body?.acceptorId, req.body?.rejectorId, req.body?.initiatorId].filter(Boolean);
  if (suppliedIds.some(id => String(id) !== String(req.user._id)))
    return res.status(403).json({ success: false, error: "Access denied" });
  next();
});
const ownAccount = (req, res, next) => String(req.params.userId) === String(req.user._id)
  ? next() : res.status(403).json({ success: false, error: "Access denied" });

// Stream token for voice/video calls
router.get("/stream/token", authenticateToken, getStreamToken);

// Call Request Management
router.post("/calls/initiate", authenticateToken, requireUnblockedInteraction, videoCallController.initiateCall);
router.get("/calls/pending/:userId", ownAccount, videoCallController.getPendingRequests);
router.put("/calls/:callId/accept", authenticateToken, videoCallController.acceptCall);
router.put("/calls/:callId/reject", authenticateToken, videoCallController.rejectCall);
router.post("/calls/:callId/resend", authenticateToken, videoCallController.resendCallRequest);

// Call Management
router.post("/calls/:callId/join", authenticateToken, videoCallController.joinCall);
router.put("/calls/:callId/end", authenticateToken, videoCallController.endCall);

// History & Status
router.get("/calls/history/:userId", ownAccount, videoCallController.getCallHistory);
router.get("/calls/active/:userId", ownAccount, videoCallController.getActiveCalls);
router.delete("/calls/:callId", authenticateToken, videoCallController.deleteCall);
router.get("/calls/:callId/details", videoCallController.getCallDetails);

// User Status
router.put("/users/status", videoCallController.updateUserStatus);
router.get("/users/status/:userId", videoCallController.getUserStatus);

// Utility endpoints
if (process.env.NODE_ENV !== "production") {
  router.get("/calls/all", videoCallController.getAllCalls);
}

export default router;

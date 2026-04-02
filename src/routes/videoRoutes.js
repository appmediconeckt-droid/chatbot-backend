import express from 'express';
import { videoCallController } from '../controllers/videoCallController.js';

const router = express.Router();

// Call Management
router.post('/calls/initiate', videoCallController.initiateCall);
router.put('/calls/:callId/accept', videoCallController.acceptCall);
router.post('/calls/:callId/join', videoCallController.joinCall);
router.put('/calls/:callId/end', videoCallController.endCall);
router.put('/calls/:callId/reject', videoCallController.rejectCall);
router.get('/calls/:callId/details', videoCallController.getCallDetails);

// Queue Management
router.get('/calls/waiting/:userId/:userType', videoCallController.getWaitingCalls);

// History & Status
router.get('/calls/history/:userId', videoCallController.getCallHistory);
router.get('/calls/active/:userId', videoCallController.getActiveCalls);
router.get('/calls/all', videoCallController.getAllCalls); // Test endpoint

// User Status
router.put('/users/status', videoCallController.updateUserStatus);
router.get('/users/status/:userId', videoCallController.getUserStatus);

// Contacts
router.get('/contacts/available/:userType', videoCallController.getAvailableContacts);

export default router;
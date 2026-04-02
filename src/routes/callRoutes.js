import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  initiateCall,
  getCallDetails,
  acceptCall,
  rejectCall,
  endCall,
  updateCallStatus,
  missCall,
  getCallHistory,
  getRecentCalls,
  getActiveCall,
  ringCall
} from '../controllers/callController.js';

const router = express.Router();

// ==================== CALL MANAGEMENT ROUTES ====================

/**
 * @route   POST /api/call/initiate
 * @desc    Initiate a new audio/video call
 * @access  Private
 * @body    { chatId: string, callType: string, receiverId: string }
 */
router.post('/initiate', authenticateToken, initiateCall);

/**
 * @route   GET /api/call/:callId
 * @desc    Get call details by callId
 * @access  Private
 */
router.get('/:callId', authenticateToken, getCallDetails);

/**
 * @route   POST /api/call/:callId/accept
 * @desc    Accept an incoming call
 * @access  Private (only receiver)
 */
router.post('/:callId/accept', authenticateToken, acceptCall);

/**
 * @route   POST /api/call/:callId/reject
 * @desc    Reject an incoming call
 * @access  Private (only receiver)
 */
router.post('/:callId/reject', authenticateToken, rejectCall);

/**
 * @route   POST /api/call/:callId/end
 * @desc    End an active call
 * @access  Private (participants)
 */
router.post('/:callId/end', authenticateToken, endCall);

/**
 * @route   POST /api/call/:callId/miss
 * @desc    Mark a call as missed (timeout)
 * @access  Private
 */
router.post('/:callId/miss', authenticateToken, missCall);

/**
 * @route   POST /api/call/:callId/ring
 * @desc    Mark call as ringing
 * @access  Private
 */
router.post('/:callId/ring', authenticateToken, ringCall);

/**
 * @route   PATCH /api/call/:callId/status
 * @desc    Update call status (mute, speaker, hold, quality)
 * @access  Private
 * @body    { isMuted?: boolean, isSpeakerOn?: boolean, isOnHold?: boolean, callQuality?: string }
 */
router.patch('/:callId/status', authenticateToken, updateCallStatus);

// ==================== CALL HISTORY ROUTES ====================

/**
 * @route   GET /api/call/history/chat/:chatId
 * @desc    Get call history for a specific chat
 * @access  Private (chat participants)
 * @query   { number } page - Page number
 * @query   { number } limit - Items per page
 */
router.get('/history/chat/:chatId', authenticateToken, getCallHistory);

/**
 * @route   GET /api/call/history/recent
 * @desc    Get recent calls for current user
 * @access  Private
 * @query   { number } limit - Items per page (default: 20)
 */
router.get('/history/recent', authenticateToken, getRecentCalls);

/**
 * @route   GET /api/call/active/current
 * @desc    Get current active call for user
 * @access  Private
 */
router.get('/active/current', authenticateToken, getActiveCall);

export default router;
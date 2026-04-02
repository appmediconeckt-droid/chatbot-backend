import { v4 as uuidv4 } from 'uuid';

// In-memory storage (replace with database in production)
const callHistory = [];
const activeCalls = new Map();
const callQueue = []; // For handling waiting calls
const userCallHistory = new Map(); // userId -> array of calls
const userStatus = new Map(); // Track online/busy status of users

// Import your actual database models
// import User from '../models/User.js';
// import Counsellor from '../models/Counsellor.js';

export const videoCallController = {
  
  // Helper function to get user details from your existing database
  async getUserDetails(userId, userType) {
    try {
      // REPLACE THIS WITH YOUR ACTUAL DATABASE QUERY
      // Example for MongoDB with Mongoose:
      /*
      if (userType === 'counsellor') {
        const counsellor = await Counsellor.findById(userId).select('name email specialization rating');
        if (!counsellor) return null;
        return {
          id: counsellor._id,
          name: counsellor.name,
          email: counsellor.email,
          type: 'counsellor',
          specialization: counsellor.specialization,
          rating: counsellor.rating
        };
      } else {
        const user = await User.findById(userId).select('name email');
        if (!user) return null;
        return {
          id: user._id,
          name: user.name,
          email: user.email,
          type: 'user'
        };
      }
      */
      
      // Example for Prisma:
      /*
      if (userType === 'counsellor') {
        const counsellor = await prisma.counsellor.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, specialization: true, rating: true }
        });
        if (!counsellor) return null;
        return {
          id: counsellor.id,
          name: counsellor.name,
          email: counsellor.email,
          type: 'counsellor',
          specialization: counsellor.specialization,
          rating: counsellor.rating
        };
      } else {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true }
        });
        if (!user) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          type: 'user'
        };
      }
      */
      
      // TEMPORARY: Replace this with your actual database query above
      console.log(`Fetching user details for ${userType} with ID: ${userId}`);
      console.log('Please implement getUserDetails with your actual database query');
      
      // For now, return a basic object (replace with actual DB call)
      return {
        id: userId,
        name: userType === 'counsellor' ? 'Counsellor Name' : 'User Name',
        email: `${userId}@example.com`,
        type: userType,
        specialization: userType === 'counsellor' ? 'General Counseling' : null,
        rating: userType === 'counsellor' ? 4.5 : null
      };
      
    } catch (error) {
      console.error('Error in getUserDetails:', error);
      return null;
    }
  },

  // 1. Initiate a call (both user and counsellor can initiate)
  initiateCall: async (req, res) => {
    try {
      const { 
        initiatorId, 
        initiatorType,
        receiverId, 
        receiverType,
        callType = 'video' 
      } = req.body;
      
      if (!initiatorId || !initiatorType || !receiverId || !receiverType) {
        return res.status(400).json({ 
          success: false, 
          error: 'initiatorId, initiatorType, receiverId, and receiverType are required' 
        });
      }
      
      // Get real user details from database
      const initiatorDetails = await videoCallController.getUserDetails(initiatorId, initiatorType);
      const receiverDetails = await videoCallController.getUserDetails(receiverId, receiverType);
      
      if (!initiatorDetails || !receiverDetails) {
        return res.status(404).json({ 
          success: false, 
          error: 'Initiator or receiver not found' 
        });
      }
      
      // Check if receiver is available
      const receiverStatus = userStatus.get(receiverId) || { status: 'offline', currentCall: null };
      
      if (receiverStatus.status === 'busy') {
        return res.status(409).json({
          success: false,
          error: 'Receiver is currently busy on another call',
          status: 'busy'
        });
      }
      
      const callId = uuidv4();
      const roomId = uuidv4();
      
      const callData = {
        callId,
        roomId,
        type: callType,
        status: 'initiated',
        initiatedBy: initiatorType,
        initiator: {
          id: initiatorId,
          name: initiatorDetails.name,
          type: initiatorType,
          joinedAt: new Date(),
          email: initiatorDetails.email,
          ...initiatorDetails
        },
        receiver: {
          id: receiverId,
          name: receiverDetails.name,
          type: receiverType,
          joinedAt: null,
          email: receiverDetails.email,
          ...receiverDetails
        },
        createdAt: new Date(),
        startTime: null,
        endTime: null,
        duration: 0,
        participants: new Map(),
        endedBy: null,
        waitingInQueue: false
      };
      
      // Add initiator to participants
      callData.participants.set(initiatorId, {
        userId: initiatorId,
        userName: initiatorDetails.name,
        role: 'initiator',
        type: initiatorType,
        joinedAt: new Date(),
        isVideoEnabled: true,
        isAudioEnabled: true,
        isScreenSharing: false
      });
      
      // Check if receiver is online and available
      if (receiverStatus.status === 'online') {
        callData.status = 'ringing';
        activeCalls.set(callId, callData);
        
        // Emit real-time notification
        if (global.io) {
          global.io.to(`user_${receiverId}`).emit('incoming_call', {
            callId,
            roomId,
            from: initiatorDetails.name,
            fromId: initiatorId,
            fromType: initiatorType,
            callType,
            timestamp: new Date()
          });
        }
      } else {
        // Add to waiting queue if receiver is offline
        callData.status = 'waiting';
        callData.waitingInQueue = true;
        activeCalls.set(callId, callData);
        
        callQueue.push({
          callId,
          initiatorId,
          initiatorName: initiatorDetails.name,
          initiatorType,
          receiverId,
          receiverName: receiverDetails.name,
          receiverType,
          timestamp: new Date(),
          waitingSince: new Date()
        });
      }
      
      res.status(201).json({
        success: true,
        callId,
        roomId,
        status: callData.status,
        callData: {
          id: callId,
          roomId,
          initiator: { id: initiatorId, name: initiatorDetails.name, type: initiatorType },
          receiver: { id: receiverId, name: receiverDetails.name, type: receiverType },
          status: callData.status,
          createdAt: new Date()
        }
      });
      
    } catch (error) {
      console.error('Error initiating call:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to initiate call',
        details: error.message 
      });
    }
  },
  
  // 2. Accept incoming call
  acceptCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const { acceptorId, acceptorType } = req.body;
      
      const call = activeCalls.get(callId);
      
      if (!call) {
        return res.status(404).json({ 
          success: false, 
          error: 'Call not found or has expired' 
        });
      }
      
      // Verify the acceptor is the intended receiver
      if (call.receiver.id !== acceptorId) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not the intended recipient of this call' 
        });
      }
      
      if (call.status !== 'initiated' && call.status !== 'ringing' && call.status !== 'waiting') {
        return res.status(400).json({ 
          success: false, 
          error: `Call cannot be accepted. Current status: ${call.status}` 
        });
      }
      
      // Get acceptor details
      const acceptorDetails = await videoCallController.getUserDetails(acceptorId, acceptorType);
      
      // Update receiver joined time
      call.receiver.joinedAt = new Date();
      
      // Add acceptor to participants
      call.participants.set(acceptorId, {
        userId: acceptorId,
        userName: acceptorDetails.name,
        role: 'receiver',
        type: acceptorType,
        joinedAt: new Date(),
        isVideoEnabled: true,
        isAudioEnabled: true,
        isScreenSharing: false
      });
      
      call.status = 'connected';
      call.startTime = new Date();
      call.waitingInQueue = false;
      
      // Update user status
      userStatus.set(call.initiator.id, { status: 'busy', currentCall: callId });
      userStatus.set(call.receiver.id, { status: 'busy', currentCall: callId });
      
      // Remove from queue
      const queueIndex = callQueue.findIndex(q => q.callId === callId);
      if (queueIndex !== -1) callQueue.splice(queueIndex, 1);
      
      // Notify initiator that call was accepted
      if (global.io) {
        global.io.to(`user_${call.initiator.id}`).emit('call_accepted', {
          callId,
          roomId: call.roomId,
          by: acceptorDetails.name,
          timestamp: new Date()
        });
      }
      
      res.json({
        success: true,
        callId,
        roomId: call.roomId,
        status: 'connected',
        startTime: call.startTime,
        participants: Array.from(call.participants.values()),
        message: 'Call accepted successfully'
      });
      
    } catch (error) {
      console.error('Error accepting call:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to accept call',
        details: error.message 
      });
    }
  },
  
  // 3. Join existing call
  joinCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const { userId, userType } = req.body;
      
      const call = activeCalls.get(callId);
      
      if (!call) {
        return res.status(404).json({ 
          success: false, 
          error: 'Call not found' 
        });
      }
      
      if (call.status === 'ended') {
        return res.status(400).json({ 
          success: false, 
          error: 'Call has already ended' 
        });
      }
      
      // Check if user is authorized
      const isInitiator = call.initiator.id === userId;
      const isReceiver = call.receiver.id === userId;
      
      if (!isInitiator && !isReceiver) {
        return res.status(403).json({ 
          success: false, 
          error: 'Not authorized to join this call' 
        });
      }
      
      // Get user details
      const userDetails = await videoCallController.getUserDetails(userId, userType);
      
      // Add or update participant
      if (!call.participants.has(userId)) {
        call.participants.set(userId, {
          userId,
          userName: userDetails.name,
          role: isInitiator ? 'initiator' : 'receiver',
          type: userType,
          joinedAt: new Date(),
          isVideoEnabled: true,
          isAudioEnabled: true,
          isScreenSharing: false
        });
      }
      
      // Update status if both participants are in
      if (call.participants.size === 2 && call.status === 'ringing') {
        call.status = 'connected';
        call.startTime = new Date();
      }
      
      res.json({
        success: true,
        callId,
        roomId: call.roomId,
        status: call.status,
        participants: Array.from(call.participants.values()),
        startTime: call.startTime,
        token: call.roomId
      });
      
    } catch (error) {
      console.error('Error joining call:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to join call',
        details: error.message 
      });
    }
  },
  
  // 4. Get waiting calls for a user
  getWaitingCalls: async (req, res) => {
    try {
      const { userId } = req.params;
      
      const waitingCalls = callQueue
        .filter(call => call.receiverId === userId)
        .map(call => ({
          callId: call.callId,
          fromId: call.initiatorId,
          fromName: call.initiatorName,
          fromType: call.initiatorType,
          timestamp: call.timestamp,
          waitingDuration: Math.floor((new Date() - call.timestamp) / 1000)
        }));
      
      res.json({
        success: true,
        waitingCalls,
        count: waitingCalls.length
      });
      
    } catch (error) {
      console.error('Error getting waiting calls:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get waiting calls',
        details: error.message 
      });
    }
  },
  
  // 5. Reject call
  rejectCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const { userId, reason = 'busy' } = req.body;
      
      const call = activeCalls.get(callId);
      
      if (!call) {
        return res.status(404).json({ 
          success: false, 
          error: 'Call not found' 
        });
      }
      
      // Save to history as missed
      const historyEntry = {
        id: call.callId,
        roomId: call.roomId,
        type: call.type,
        status: 'missed',
        initiatedBy: call.initiatedBy,
        initiator: call.initiator,
        receiver: call.receiver,
        createdAt: call.createdAt,
        endedAt: new Date(),
        reason,
        duration: 0,
        rejectedBy: userId
      };
      
      callHistory.unshift(historyEntry);
      
      // Store in user's call history
      [call.initiator.id, call.receiver.id].forEach(uid => {
        if (!userCallHistory.has(uid)) {
          userCallHistory.set(uid, []);
        }
        userCallHistory.get(uid).push(historyEntry);
      });
      
      // Notify initiator
      if (global.io) {
        global.io.to(`user_${call.initiator.id}`).emit('call_rejected', {
          callId,
          reason,
          by: call.receiver.name
        });
      }
      
      // Remove from active calls and queue
      activeCalls.delete(callId);
      const queueIndex = callQueue.findIndex(q => q.callId === callId);
      if (queueIndex !== -1) callQueue.splice(queueIndex, 1);
      
      res.json({
        success: true,
        message: 'Call rejected',
        call: historyEntry
      });
      
    } catch (error) {
      console.error('Error rejecting call:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to reject call',
        details: error.message 
      });
    }
  },
  
  // 6. End call
  endCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const { userId } = req.body;
      
      const call = activeCalls.get(callId);
      
      if (!call) {
        return res.status(404).json({ 
          success: false, 
          error: 'Call not found' 
        });
      }
      
      const endTime = new Date();
      const duration = call.startTime 
        ? Math.floor((endTime - call.startTime) / 1000)
        : 0;
      
      // Determine who ended the call
      const endedBy = call.initiator.id === userId ? call.initiator : call.receiver;
      
      // Save to history
      const historyEntry = {
        id: call.callId,
        roomId: call.roomId,
        type: call.type,
        status: 'completed',
        initiatedBy: call.initiatedBy,
        initiator: call.initiator,
        receiver: call.receiver,
        createdAt: call.createdAt,
        startTime: call.startTime,
        endTime,
        duration,
        endedBy: {
          id: endedBy.id,
          name: endedBy.name,
          type: endedBy.type
        },
        participants: Array.from(call.participants.values())
      };
      
      callHistory.unshift(historyEntry);
      
      // Store in user's call history
      [call.initiator.id, call.receiver.id].forEach(uid => {
        if (!userCallHistory.has(uid)) {
          userCallHistory.set(uid, []);
        }
        userCallHistory.get(uid).push(historyEntry);
      });
      
      // Update user status
      userStatus.set(call.initiator.id, { status: 'online', currentCall: null });
      userStatus.set(call.receiver.id, { status: 'online', currentCall: null });
      
      // Remove from active calls
      activeCalls.delete(callId);
      
      // Remove from queue if exists
      const queueIndex = callQueue.findIndex(q => q.callId === callId);
      if (queueIndex !== -1) callQueue.splice(queueIndex, 1);
      
      // Notify other participant
      const otherParticipant = call.initiator.id === userId ? call.receiver.id : call.initiator.id;
      if (global.io) {
        global.io.to(`user_${otherParticipant}`).emit('call_ended', {
          callId,
          duration,
          endedBy: endedBy.name
        });
      }
      
      res.json({
        success: true,
        message: 'Call ended successfully',
        callSummary: {
          callId,
          duration,
          endedAt: endTime,
          with: endedBy.id === userId ? call.receiver.name : call.initiator.name,
          endedBy: endedBy.name
        }
      });
      
    } catch (error) {
      console.error('Error ending call:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to end call',
        details: error.message 
      });
    }
  },
  
  // 7. Update user status
  updateUserStatus: async (req, res) => {
    try {
      const { userId, status } = req.body;
      
      if (!['online', 'offline', 'busy', 'away'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be: online, offline, busy, or away'
        });
      }
      
      const currentStatus = userStatus.get(userId) || { status: 'offline', currentCall: null };
      currentStatus.status = status;
      userStatus.set(userId, currentStatus);
      
      // Broadcast status update to all connected clients
      if (global.io) {
        global.io.emit('user_status_changed', {
          userId,
          status,
          timestamp: new Date()
        });
      }
      
      res.json({
        success: true,
        message: 'Status updated successfully',
        status: currentStatus
      });
      
    } catch (error) {
      console.error('Error updating user status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update status',
        details: error.message
      });
    }
  },
  
  // 8. Get user status
  getUserStatus: async (req, res) => {
    try {
      const { userId } = req.params;
      
      const status = userStatus.get(userId) || { status: 'offline', currentCall: null };
      
      res.json({
        success: true,
        userId,
        status: status.status,
        currentCall: status.currentCall,
        isAvailable: status.status === 'online'
      });
      
    } catch (error) {
      console.error('Error getting user status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user status',
        details: error.message
      });
    }
  },
  
  // 9. Get call history
  getCallHistory: async (req, res) => {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 20, status = 'all', type = 'all' } = req.query;
      
      let userCalls = userCallHistory.get(userId) || [];
      
      // Filter by status
      if (status !== 'all') {
        userCalls = userCalls.filter(call => call.status === status);
      }
      
      // Filter by type (initiated or received)
      if (type === 'initiated') {
        userCalls = userCalls.filter(call => call.initiator.id === userId);
      } else if (type === 'received') {
        userCalls = userCalls.filter(call => call.receiver.id === userId);
      }
      
      // Sort by timestamp descending
      userCalls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      // Paginate
      const start = (parseInt(page) - 1) * parseInt(limit);
      const end = start + parseInt(limit);
      const paginatedCalls = userCalls.slice(start, end);
      
      // Format response
      const formattedCalls = paginatedCalls.map(call => {
        const isInitiator = call.initiator.id === userId;
        const otherParticipant = isInitiator ? call.receiver : call.initiator;
        
        return {
          id: call.id,
          with: otherParticipant.name,
          withId: otherParticipant.id,
          withType: otherParticipant.type,
          type: call.type,
          duration: call.duration,
          timestamp: call.createdAt,
          status: call.status,
          role: isInitiator ? 'initiator' : 'receiver',
          endedBy: call.endedBy,
          reason: call.reason
        };
      });
      
      res.json({
        success: true,
        history: formattedCalls,
        total: userCalls.length,
        page: parseInt(page),
        totalPages: Math.ceil(userCalls.length / parseInt(limit))
      });
      
    } catch (error) {
      console.error('Error fetching call history:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch call history',
        details: error.message 
      });
    }
  },
  
  // 10. Get active calls
  getActiveCalls: async (req, res) => {
    try {
      const { userId } = req.params;
      const activeCallsList = [];
      
      activeCalls.forEach((call, callId) => {
        if (call.status !== 'ended' && 
            (call.initiator.id === userId || call.receiver.id === userId)) {
          
          const isInitiator = call.initiator.id === userId;
          const otherParticipant = isInitiator ? call.receiver : call.initiator;
          
          activeCallsList.push({
            callId,
            roomId: call.roomId,
            with: otherParticipant.name,
            withId: otherParticipant.id,
            withType: otherParticipant.type,
            status: call.status,
            startTime: call.startTime,
            createdAt: call.createdAt,
            participants: Array.from(call.participants.values()),
            duration: call.startTime 
              ? Math.floor((new Date() - call.startTime) / 1000)
              : 0
          });
        }
      });
      
      res.json({
        success: true,
        activeCalls: activeCallsList,
        count: activeCallsList.length
      });
      
    } catch (error) {
      console.error('Error fetching active calls:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch active calls',
        details: error.message 
      });
    }
  },
  
  // 11. Get available contacts
  getAvailableContacts: async (req, res) => {
    try {
      const { userType } = req.params;
      
      const availableContacts = [];
      
      for (const [userId, status] of userStatus.entries()) {
        if (status.status === 'online' && status.currentCall === null) {
          const userDetails = await videoCallController.getUserDetails(userId, 
            userId.startsWith('counsellor') ? 'counsellor' : 'user'
          );
          
          if (userDetails && userDetails.type === userType) {
            availableContacts.push({
              id: userDetails.id,
              name: userDetails.name,
              type: userDetails.type,
              status: 'available',
              specialization: userDetails.specialization,
              rating: userDetails.rating
            });
          }
        }
      }
      
      res.json({
        success: true,
        contacts: availableContacts,
        count: availableContacts.length
      });
      
    } catch (error) {
      console.error('Error fetching available contacts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch available contacts',
        details: error.message
      });
    }
  },
  
  // 12. Get call details
  getCallDetails: async (req, res) => {
    try {
      const { callId } = req.params;
      
      let call = activeCalls.get(callId);
      let isActive = true;
      
      if (!call) {
        call = callHistory.find(c => c.id === callId);
        isActive = false;
      }
      
      if (!call) {
        return res.status(404).json({ 
          success: false, 
          error: 'Call not found' 
        });
      }
      
      res.json({
        success: true,
        call: {
          id: call.id || call.callId,
          roomId: call.roomId,
          type: call.type,
          status: call.status,
          initiator: call.initiator,
          receiver: call.receiver,
          startTime: call.startTime,
          endTime: call.endTime,
          duration: call.duration,
          participants: isActive ? Array.from(call.participants.values()) : call.participants,
          endedBy: call.endedBy
        },
        isActive
      });
      
    } catch (error) {
      console.error('Error fetching call details:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch call details',
        details: error.message 
      });
    }
  },
  
  // Test endpoint
  getAllCalls: async (req, res) => {
    try {
      res.json({
        success: true,
        activeCalls: Array.from(activeCalls.values()).map(call => ({
          callId: call.callId,
          initiator: call.initiator,
          receiver: call.receiver,
          status: call.status,
          participants: Array.from(call.participants.values())
        })),
        callQueue,
        history: callHistory,
        userStatus: Array.from(userStatus.entries()),
        activeCount: activeCalls.size,
        queueCount: callQueue.length,
        historyCount: callHistory.length
      });
    } catch (error) {
      console.error('Error getting all calls:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get calls',
        details: error.message 
      });
    }
  }
};
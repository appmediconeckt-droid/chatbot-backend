import Call from '../models/Call.js';
import { getAnonymousUserName } from '../utils/anonymousUser.js';
import Chat from '../models/Chat.js';
import User from '../models/userModel.js';
import Message from '../models/Message.js';

// Ordinary call setup does not require a participant's precise location.
const pickUserLocationForCall = () => ({ locationText: null, locationData: null });
const callPerson = (call, side, viewerRole) => {
  const patient = side === 'caller' ? call.initiatorType === 'user' : call.receiverType === 'user';
  const privateIdentity = viewerRole === 'counsellor' && patient;
  return {
    name: privateIdentity ? 'Anonymous User' : call[`${side}Name`],
    avatar: privateIdentity ? null : call[`${side}Avatar`],
    location: null,
    locationData: null,
  };
};

// Initiate a new call
export const initiateCall = async (req, res) => {
  try {
    const { chatId, callType, receiverId } = req.body;
    
    if (!chatId || !callType || !receiverId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if chat exists
    const chat = await Chat.findOne({ chatId: chatId })
      .populate('userId', 'fullName anonymous role profilePhoto')
      .populate('counselorId', 'fullName anonymous role profilePhoto');
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check authorization
    const isAuthorized = (req.user.role === 'user' && chat.userId._id.toString() === req.user._id.toString()) ||
                        (req.user.role === 'counsellor' && chat.counselorId._id.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const expectedReceiver = req.user.role === 'user' ? chat.counselorId._id : chat.userId._id;
    if (String(receiverId) !== String(expectedReceiver)) {
      return res.status(403).json({ error: 'Receiver must be the other chat participant' });
    }
    
    // Get caller and receiver info
    const isCallerUser = req.user.role === 'user';
    const caller = isCallerUser ? chat.userId : chat.counselorId;
    const receiver = await User.findById(receiverId).select('fullName anonymous role profilePhoto');
    
    if (!receiver) {
      return res.status(404).json({ error: 'Receiver not found' });
    }
    
    // Check if there's an active call already
    const existingActiveCall = await Call.findOne({
      $or: [
        { chatId: chat._id, status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] }, isActive: true },
        { callerId: req.user._id, status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] }, isActive: true },
        { receiverId: req.user._id, status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] }, isActive: true }
      ]
    });
    
    if (existingActiveCall) {
      return res.status(409).json({ 
        error: 'You already have an active call',
        callId: existingActiveCall.callId,
        status: existingActiveCall.status
      });
    }
    
    // Create call record
    const callerLoc = pickUserLocationForCall(caller);
    const receiverLoc = pickUserLocationForCall(receiver);

    const call = await Call.create({
      chatId: chat._id,
      callerId: req.user._id,
      receiverId: receiverId,
      callType: callType,
      status: 'initiated',
      initiatorType: caller.role,
      receiverType: receiver.role,
      callerName: caller.role === 'user' ? getAnonymousUserName(caller) : caller.fullName,
      receiverName: receiver.role === 'user' ? getAnonymousUserName(receiver) : receiver.fullName,
      callerAvatar: caller.role === 'user' ? null : caller.profilePhoto?.url || null,
      receiverAvatar: receiver.role === 'user' ? null : receiver.profilePhoto?.url || null,
      callerLocation: callerLoc.locationText,
      receiverLocation: receiverLoc.locationText,
      callerLocationData: callerLoc.locationData || undefined,
      receiverLocationData: receiverLoc.locationData || undefined
    });
    
    // Add call message to chat
    await Message.create({
      chatId: chat._id,
      senderId: req.user._id,
      senderRole: req.user.role,
      content: `📞 ${callType === 'audio' ? 'Audio' : 'Video'} call initiated`,
      contentType: 'TEXT'
    });
    
    res.status(201).json({
      success: true,
      call: {
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        caller: {
          id: call.callerId,
          name: callPerson(call, 'caller', req.user.role).name,
          avatar: callPerson(call, 'caller', req.user.role).avatar,
          location: callPerson(call, 'caller', req.user.role).location,
          locationData: callPerson(call, 'caller', req.user.role).locationData || null
        },
        receiver: {
          id: call.receiverId,
          name: callPerson(call, 'receiver', req.user.role).name,
          avatar: callPerson(call, 'receiver', req.user.role).avatar,
          location: callPerson(call, 'receiver', req.user.role).location,
          locationData: callPerson(call, 'receiver', req.user.role).locationData || null
        },
        createdAt: call.createdAt
      }
    });
  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({ error: 'Error initiating call' });
  }
};

// Get call details
export const getCallDetails = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check authorization
    const isAuthorized = (call.callerId.toString() === req.user._id.toString()) ||
                        (call.receiverId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    res.json({
      success: true,
      call: {
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        caller: {
          id: call.callerId,
          name: callPerson(call, 'caller', req.user.role).name,
          avatar: callPerson(call, 'caller', req.user.role).avatar,
          location: callPerson(call, 'caller', req.user.role).location,
          locationData: callPerson(call, 'caller', req.user.role).locationData || null
        },
        receiver: {
          id: call.receiverId,
          name: callPerson(call, 'receiver', req.user.role).name,
          avatar: callPerson(call, 'receiver', req.user.role).avatar,
          location: callPerson(call, 'receiver', req.user.role).location,
          locationData: callPerson(call, 'receiver', req.user.role).locationData || null
        },
        isMuted: call.isMuted,
        isSpeakerOn: call.isSpeakerOn,
        isOnHold: call.isOnHold,
        callQuality: call.callQuality,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        duration: call.duration,
        formattedDuration: call.formattedDuration,
        createdAt: call.createdAt,
        endedBy: call.endedBy
      }
    });
  } catch (error) {
    console.error('Error getting call details:', error);
    res.status(500).json({ error: 'Error getting call details' });
  }
};

// Accept call
export const acceptCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check if user is the receiver
    if (call.receiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the receiver can accept the call' });
    }
    
    // Check if call is still active
    if (call.status !== 'initiated' && call.status !== 'ringing') {
      return res.status(400).json({ error: `Cannot accept call in ${call.status} state` });
    }
    
    call.status = 'connected';
    call.startedAt = new Date();
    await call.save();
    
    // Add call accepted message to chat
    const chat = await Chat.findById(call.chatId);
    if (chat) {
      await Message.create({
        chatId: chat._id,
        senderId: req.user._id,
        senderRole: req.user.role,
        content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call accepted`,
        contentType: 'TEXT'
      });
    }
    
    res.json({
      success: true,
      message: 'Call accepted',
      call: {
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        startedAt: call.startedAt
      }
    });
  } catch (error) {
    console.error('Error accepting call:', error);
    res.status(500).json({ error: 'Error accepting call' });
  }
};

// Reject call
export const rejectCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check if user is the receiver
    if (call.receiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the receiver can reject the call' });
    }
    
    // Check if call is still active
    if (call.status !== 'initiated' && call.status !== 'ringing') {
      return res.status(400).json({ error: 'Call already ended' });
    }
    
    call.status = 'rejected';
    call.endedAt = new Date();
    call.isActive = false;
    call.endedBy = req.user._id;
    await call.save();
    
    // Add call rejected message to chat
    const chat = await Chat.findById(call.chatId);
    if (chat) {
      await Message.create({
        chatId: chat._id,
        senderId: req.user._id,
        senderRole: req.user.role,
        content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call rejected`,
        contentType: 'TEXT'
      });
    }
    
    res.json({
      success: true,
      message: 'Call rejected'
    });
  } catch (error) {
    console.error('Error rejecting call:', error);
    res.status(500).json({ error: 'Error rejecting call' });
  }
};

// End call
export const endCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check authorization
    const isAuthorized = (call.callerId.toString() === req.user._id.toString()) ||
                        (call.receiverId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Calculate duration if call was connected
    if (call.status === 'connected' && call.startedAt) {
      call.duration = Math.floor((Date.now() - new Date(call.startedAt).getTime()) / 1000);
    }
    
    call.status = 'ended';
    call.endedAt = new Date();
    call.isActive = false;
    call.endedBy = req.user._id;
    await call.save();
    
    // Add call ended message to chat
    const chat = await Chat.findById(call.chatId);
    if (chat) {
      await Message.create({
        chatId: chat._id,
        senderId: req.user._id,
        senderRole: req.user.role,
        content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call ended (${call.formattedDuration})`,
        contentType: 'TEXT'
      });
    }
    
    res.json({
      success: true,
      message: 'Call ended',
      duration: call.duration,
      formattedDuration: call.formattedDuration
    });
  } catch (error) {
    console.error('Error ending call:', error);
    res.status(500).json({ error: 'Error ending call' });
  }
};

// Update call status (mute, speaker, hold, quality)
export const updateCallStatus = async (req, res) => {
  try {
    const { callId } = req.params;
    const { isMuted, isSpeakerOn, isOnHold, callQuality, status } = req.body;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check authorization
    const isAuthorized = (call.callerId.toString() === req.user._id.toString()) ||
                        (call.receiverId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Update fields
    if (isMuted !== undefined) call.isMuted = isMuted;
    if (isSpeakerOn !== undefined) call.isSpeakerOn = isSpeakerOn;
    if (isOnHold !== undefined) {
      call.isOnHold = isOnHold;
      if (isOnHold) {
        call.status = 'on-hold';
      } else if (call.status === 'on-hold') {
        call.status = 'connected';
      }
    }
    if (callQuality) call.callQuality = callQuality;
    if (status) call.status = status;
    
    await call.save();
    
    res.json({
      success: true,
      message: 'Call status updated',
      call: {
        isMuted: call.isMuted,
        isSpeakerOn: call.isSpeakerOn,
        isOnHold: call.isOnHold,
        callQuality: call.callQuality,
        status: call.status
      }
    });
  } catch (error) {
    console.error('Error updating call status:', error);
    res.status(500).json({ error: 'Error updating call status' });
  }
};

// Miss call (auto-mark when timeout)
export const missCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    if (![call.callerId, call.receiverId].some(id => String(id) === String(req.user._id))) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (call.status === 'initiated' || call.status === 'ringing') {
      call.status = 'missed';
      call.endedAt = new Date();
      call.isActive = false;
      await call.save();
      
      // Add call missed message to chat
      const chat = await Chat.findById(call.chatId);
      if (chat) {
        await Message.create({
          chatId: chat._id,
          senderId: call.callerId,
          senderRole: ['counsellor', 'counselor'].includes(call.initiatorType) ? 'counsellor' : 'user',
          content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call missed`,
          contentType: 'TEXT'
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Call marked as missed'
    });
  } catch (error) {
    console.error('Error missing call:', error);
    res.status(500).json({ error: 'Error missing call' });
  }
};

// Get call history for a chat
export const getCallHistory = async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check authorization
    const isAuthorized = (req.user.role === 'user' && chat.userId.toString() === req.user._id.toString()) ||
                        (req.user.role === 'counsellor' && chat.counselorId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // ✅ Optimized: Fetch count & data in parallel with lean() for read-only data
    const query = { chatId: chat._id, isActive: false };
    const [calls, total] = await Promise.all([
      Call.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // ✅ Read-only data - faster
      Call.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      calls: calls.map(call => ({
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        caller: {
          id: call.callerId,
          name: callPerson(call, 'caller', req.user.role).name,
          avatar: callPerson(call, 'caller', req.user.role).avatar
        },
        receiver: {
          id: call.receiverId,
          name: callPerson(call, 'receiver', req.user.role).name,
          avatar: callPerson(call, 'receiver', req.user.role).avatar
        },
        duration: call.duration,
        formattedDuration: call.formattedDuration,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        createdAt: call.createdAt,
        endedBy: call.endedBy
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting call history:', error);
    res.status(500).json({ error: 'Error getting call history' });
  }
};

// Get recent calls for user
export const getRecentCalls = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const calls = await Call.find({
      $or: [
        { callerId: req.user._id },
        { receiverId: req.user._id }
      ],
      isActive: false
    })
    .sort({ createdAt: -1 })
    .limit(limit);
    
    res.json({
      success: true,
      calls: calls.map(call => {
        const isIncoming = call.receiverId.toString() === req.user._id.toString();
        const otherParty = isIncoming ? {
          id: call.callerId,
          name: callPerson(call, 'caller', req.user.role).name,
          avatar: callPerson(call, 'caller', req.user.role).avatar,
          location: callPerson(call, 'caller', req.user.role).location,
          locationData: callPerson(call, 'caller', req.user.role).locationData || null
        } : {
          id: call.receiverId,
          name: callPerson(call, 'receiver', req.user.role).name,
          avatar: callPerson(call, 'receiver', req.user.role).avatar,
          location: callPerson(call, 'receiver', req.user.role).location,
          locationData: callPerson(call, 'receiver', req.user.role).locationData || null
        };
        
        return {
          id: call._id,
          callId: call.callId,
          callType: call.callType,
          status: call.status,
          isIncoming,
          otherParty,
          duration: call.duration,
          formattedDuration: call.formattedDuration,
          startedAt: call.startedAt,
          createdAt: call.createdAt
        };
      })
    });
  } catch (error) {
    console.error('Error getting recent calls:', error);
    res.status(500).json({ error: 'Error getting recent calls' });
  }
};

// Get active call for user
export const getActiveCall = async (req, res) => {
  try {
    const activeCall = await Call.findOne({
      $or: [
        { callerId: req.user._id },
        { receiverId: req.user._id }
      ],
      status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] },
      isActive: true
    });
    
    if (!activeCall) {
      return res.json({ success: true, hasActiveCall: false });
    }
    
    const isCaller = activeCall.callerId.toString() === req.user._id.toString();
    const otherParty = isCaller ? {
      id: activeCall.receiverId,
      name: callPerson(activeCall, 'receiver', req.user.role).name,
      avatar: callPerson(activeCall, 'receiver', req.user.role).avatar,
      location: callPerson(activeCall, 'receiver', req.user.role).location,
      locationData: callPerson(activeCall, 'receiver', req.user.role).locationData || null
    } : {
      id: activeCall.callerId,
      name: callPerson(activeCall, 'caller', req.user.role).name,
      avatar: callPerson(activeCall, 'caller', req.user.role).avatar,
      location: callPerson(activeCall, 'caller', req.user.role).location,
      locationData: callPerson(activeCall, 'caller', req.user.role).locationData || null
    };
    
    res.json({
      success: true,
      hasActiveCall: true,
      call: {
        id: activeCall._id,
        callId: activeCall.callId,
        callType: activeCall.callType,
        status: activeCall.status,
        isCaller,
        otherParty,
        isMuted: activeCall.isMuted,
        isSpeakerOn: activeCall.isSpeakerOn,
        isOnHold: activeCall.isOnHold,
        callQuality: activeCall.callQuality,
        startedAt: activeCall.startedAt
      }
    });
  } catch (error) {
    console.error('Error getting active call:', error);
    res.status(500).json({ error: 'Error getting active call' });
  }
};

// Ring call (update status to ringing)
export const ringCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    if (![call.callerId, call.receiverId].some(id => String(id) === String(req.user._id))) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (call.status === 'initiated') {
      call.status = 'ringing';
      await call.save();
    }
    
    res.json({
      success: true,
      message: 'Call is ringing'
    });
  } catch (error) {
    console.error('Error ringing call:', error);
    res.status(500).json({ error: 'Error ringing call' });
  }
};

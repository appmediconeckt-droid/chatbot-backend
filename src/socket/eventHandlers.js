import { v4 as uuidv4 } from 'uuid';
import { activeRooms } from '../config/constants.js';
import { handleUserLeave, startCallDurationTimer, cleanupRoom } from '../utils/roomHelpers.js';

export const setupEventHandlers = (socket, io) => {
  
  // 1. Join Video Room
  socket.on('join-video-room', async ({ roomId, userId }) => {
    try {
      console.log(`📹 User ${userId} joining video room: ${roomId}`);
      
      // Join socket room
      socket.join(roomId);
      
      // Create or get room data
      if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, {
          id: roomId,
          participants: new Map(),
          createdBy: userId,
          createdAt: new Date(),
          isActive: true,
          callType: 'video'
        });
      }
      
      const room = activeRooms.get(roomId);
      
      // Add participant
      room.participants.set(userId, {
        userId: userId,
        socketId: socket.id,
        userName: socket.userName,
        joinedAt: new Date(),
        isVideoEnabled: true,
        isAudioEnabled: true,
        isScreenSharing: false,
        quality: 'good'
      });
      
      // Notify other participants in the room
      socket.to(roomId).emit('user-joined', {
        userId: userId,
        userName: socket.userName,
        timestamp: new Date()
      });
      
      // Send list of existing participants to the new user
      const participantsList = Array.from(room.participants.values()).map(p => ({
        userId: p.userId,
        userName: p.userName,
        isVideoEnabled: p.isVideoEnabled,
        isAudioEnabled: p.isAudioEnabled,
        isScreenSharing: p.isScreenSharing
      }));
      
      socket.emit('room-participants', {
        roomId,
        participants: participantsList,
        callStartedAt: room.createdAt
      });
      
      // Start call duration timer
      startCallDurationTimer(roomId, io);
      
    } catch (error) {
      console.error('Error joining video room:', error);
      socket.emit('error', { message: 'Failed to join video room' });
    }
  });
  
  // 2. Handle WebRTC Offer
  socket.on('video-offer', async ({ offer, roomId, userId }) => {
    try {
      console.log(`📤 Video offer from ${userId} in room ${roomId}`);
      socket.to(roomId).emit('video-offer', {
        offer,
        userId,
        from: userId
      });
    } catch (error) {
      console.error('Error handling video offer:', error);
      socket.emit('error', { message: 'Failed to send video offer' });
    }
  });
  
  // 3. Handle WebRTC Answer
  socket.on('video-answer', async ({ answer, roomId, userId }) => {
    try {
      console.log(`📥 Video answer from ${userId} in room ${roomId}`);
      socket.to(roomId).emit('video-answer', {
        answer,
        userId,
        from: userId
      });
    } catch (error) {
      console.error('Error handling video answer:', error);
      socket.emit('error', { message: 'Failed to send video answer' });
    }
  });
  
  // 4. Handle ICE Candidates
  socket.on('ice-candidate', async ({ candidate, roomId, userId }) => {
    try {
      socket.to(roomId).emit('ice-candidate', {
        candidate,
        userId,
        from: userId
      });
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  });
  
  // 5. Toggle Video
  socket.on('toggle-video', ({ roomId, userId, enabled }) => {
    try {
      const room = activeRooms.get(roomId);
      if (room && room.participants.has(userId)) {
        const participant = room.participants.get(userId);
        participant.isVideoEnabled = enabled;
        
        socket.to(roomId).emit('video-toggled', {
          userId,
          enabled,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error toggling video:', error);
    }
  });
  
  // 6. Toggle Audio/Mute
  socket.on('toggle-audio', ({ roomId, userId, muted }) => {
    try {
      const room = activeRooms.get(roomId);
      if (room && room.participants.has(userId)) {
        const participant = room.participants.get(userId);
        participant.isAudioEnabled = !muted;
        
        socket.to(roomId).emit('audio-toggled', {
          userId,
          muted,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error toggling audio:', error);
    }
  });
  
  // 7. Switch Camera
  socket.on('switch-camera', ({ roomId, userId, cameraType }) => {
    try {
      socket.to(roomId).emit('camera-switched', {
        userId,
        cameraType,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error switching camera:', error);
    }
  });
  
  // 8. Start Screen Sharing
  socket.on('start-screen-share', ({ roomId, userId }) => {
    try {
      const room = activeRooms.get(roomId);
      if (room && room.participants.has(userId)) {
        const participant = room.participants.get(userId);
        participant.isScreenSharing = true;
        
        socket.to(roomId).emit('screen-share-started', {
          userId,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error starting screen share:', error);
    }
  });
  
  // 9. Stop Screen Sharing
  socket.on('stop-screen-share', ({ roomId, userId }) => {
    try {
      const room = activeRooms.get(roomId);
      if (room && room.participants.has(userId)) {
        const participant = room.participants.get(userId);
        participant.isScreenSharing = false;
        
        socket.to(roomId).emit('screen-share-stopped', {
          userId,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error stopping screen share:', error);
    }
  });
  
  // 10. Handle Connection Quality
  socket.on('connection-quality', ({ roomId, userId, quality }) => {
    try {
      const room = activeRooms.get(roomId);
      if (room && room.participants.has(userId)) {
        const participant = room.participants.get(userId);
        participant.quality = quality;
        
        socket.to(roomId).emit('quality-updated', {
          userId,
          quality,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error updating quality:', error);
    }
  });
  
  // 11. Recording Status
  socket.on('recording-status', ({ roomId, userId, isRecording }) => {
    try {
      socket.to(roomId).emit('recording-status-changed', {
        userId,
        isRecording,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error updating recording status:', error);
    }
  });
  
  // 12. Leave Video Room
  socket.on('leave-video-room', ({ roomId, userId }) => {
    handleUserLeave(roomId, userId, socket, io);
  });
  
  // 13. End Video Call
  socket.on('end-call', ({ roomId, userId }) => {
    try {
      const room = activeRooms.get(roomId);
      if (room) {
        io.to(roomId).emit('call-ended', {
          endedBy: userId,
          timestamp: new Date()
        });
        
        cleanupRoom(roomId);
      }
    } catch (error) {
      console.error('Error ending call:', error);
    }
  });
  
  // 14. Send Chat Message during Video Call
  socket.on('call-chat-message', ({ roomId, userId, message }) => {
    try {
      const room = activeRooms.get(roomId);
      if (room) {
        io.to(roomId).emit('call-chat-message', {
          userId,
          userName: socket.userName,
          message,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  });
  
  // 15. Request Video Recording
  socket.on('request-recording', ({ roomId, userId }) => {
    try {
      const recordingId = uuidv4();
      io.to(roomId).emit('recording-started', {
        recordingId,
        startedBy: userId,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  });
};
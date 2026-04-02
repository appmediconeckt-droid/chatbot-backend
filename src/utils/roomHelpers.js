import { activeRooms, roomTimers } from '../config/constants.js';

export const handleUserLeave = (roomId, userId, socket, io) => {
  try {
    const room = activeRooms.get(roomId);
    if (room) {
      // Remove participant
      room.participants.delete(userId);
      
      // Leave socket room
      socket.leave(roomId);
      
      // Notify other participants
      socket.to(roomId).emit('user-left', {
        userId,
        userName: socket.userName,
        timestamp: new Date()
      });
      
      // If room is empty, clean up
      if (room.participants.size === 0) {
        cleanupRoom(roomId);
      }
    }
  } catch (error) {
    console.error('Error handling user leave:', error);
  }
};

export const cleanupRoom = (roomId) => {
  if (activeRooms.has(roomId)) {
    activeRooms.delete(roomId);
    console.log(`🧹 Video room ${roomId} cleaned up`);
  }
  
  if (roomTimers.has(roomId)) {
    clearInterval(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }
};

export const startCallDurationTimer = (roomId, io) => {
  // Send call duration every second to all participants
  const interval = setInterval(() => {
    const room = activeRooms.get(roomId);
    if (room && room.isActive && room.participants.size > 0) {
      const duration = Math.floor((new Date() - room.createdAt) / 1000);
      io.to(roomId).emit('call-duration', {
        duration,
        roomId
      });
    } else {
      clearInterval(interval);
      roomTimers.delete(roomId);
    }
  }, 1000);
  
  roomTimers.set(roomId, interval);
};
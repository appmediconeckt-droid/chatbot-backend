import { userSockets, socketUsers, activeRooms } from '../config/constants.js';
import { setupEventHandlers } from './eventHandlers.js';
import { handleUserLeave } from '../utils/roomHelpers.js';

export const handleConnection = (socket, io) => {
  // console.log(`🔌 User connected: ${socket.userId} (${socket.id})`);
  
  // Store user connection
  userSockets.set(socket.userId, socket.id);
  socketUsers.set(socket.id, socket.userId);
  
  // Setup all event handlers
  setupEventHandlers(socket, io);
  
  // Handle disconnect
  socket.on('disconnect', () => {
    // console.log(`🔌 User disconnected: ${socket.userId} (${socket.id})`);
    
    const userId = socket.userId;
    
    // Find all rooms this user was in and remove them
    activeRooms.forEach((room, roomId) => {
      if (room.participants.has(userId)) {
        handleUserLeave(roomId, userId, socket, io);
      }
    });
    
    // Clean up maps
    userSockets.delete(userId);
    socketUsers.delete(socket.id);
  });
};
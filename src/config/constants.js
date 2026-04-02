// Store active video calls and rooms
export const activeRooms = new Map(); // roomId -> { participants, callData }
export const userSockets = new Map(); // userId -> socketId
export const socketUsers = new Map(); // socketId -> userId
export const roomTimers = new Map(); // roomId -> timer interval

// JWT Secret
export const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
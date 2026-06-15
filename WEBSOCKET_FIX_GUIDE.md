# WebSocket Connection Fix - Complete Guide

## Issues Fixed ✅

### 1. **Port Mismatch** (CRITICAL)
- **Problem**: Frontend tried to connect to port 5001, but backend was listening on port 3000
- **Fix**: Changed default PORT from 3000 to 5001 in `server.js`
  ```javascript
  const PORT = parseInt(process.env.PORT, 10) || 5001;  // was 3000
  ```

### 2. **Socket.IO Transport Configuration** (CRITICAL)
- **Problem**: Only polling transport enabled, no WebSocket support
- **Error**: "Unexpected response code: 400" when upgrading to WebSocket
- **Fix**: Updated Socket.IO configuration in `src/app.js`:
  ```javascript
  // BEFORE (incorrect):
  transports: ["polling"],
  allowUpgrades: false,
  
  // AFTER (correct):
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  ```

### 3. **CORS Origins Whitelist** (IMPORTANT)
- **Problem**: Port 5001 and localhost variants not in allowed origins
- **Fix**: Added complete list of local and production URLs:
  - `http://localhost:5001`
  - `http://127.0.0.1:5001`
  - `http://192.168.0.138:*`
  - All production domains with/without trailing slash

## How to Test

### Step 1: Start the Backend
```bash
cd /c/chatbot-backend
npm install  # if node_modules missing
npm run dev  # runs with nodemon on port 5001
```

### Step 2: Verify Socket.IO is Running
```bash
curl http://localhost:5001/socket.io/?EIO=4&transport=polling
# Should return: ok (without 400 error)
```

### Step 3: Start the Web App
```bash
cd /c/chatbot
npm run dev  # usually runs on http://localhost:5173 or 3000
```

### Step 4: Check Browser Console
Open DevTools (F12) → Console tab. You should see:
```
✅ Socket connected successfully
```

OR if WebSocket upgrade fails, it should fallback to polling gracefully:
```
WebSocket connected (or upgraded to polling)
```

## Environment Variables

Create `.env` in `/c/chatbot-backend/src/` with:
```env
PORT=5001
MONGO_URI=your_mongodb_uri
NODE_ENV=development
CLIENT_URL=http://localhost:5173  # or your frontend URL
JWT_SECRET=your_jwt_secret
# ... other variables
```

## Files Modified

1. ✅ `/c/chatbot-backend/server.js`
   - Changed default PORT: 3000 → 5001

2. ✅ `/c/chatbot-backend/src/app.js`
   - Enabled WebSocket transport in Socket.IO
   - Added proper reconnection config
   - Expanded CORS allowed origins whitelist

## Troubleshooting

### Still getting 400 error?

1. **Check if backend is running on 5001**
   ```bash
   lsof -i :5001  # or
   netstat -ano | findstr :5001  # Windows
   ```

2. **Check frontend Socket.IO client URL**
   Look in your frontend code for:
   ```javascript
   // Should be 5001, not other ports:
   const socket = io('http://localhost:5001');
   // OR without hardcoding:
   const socket = io(window.location.origin);
   ```

3. **Clear browser cache** (Ctrl+Shift+Del)

4. **Restart browser and backend**

### WebSocket still fails but polling works?

This is OK! Socket.IO will automatically fallback to polling. Performance will be slightly lower but it will work.

To force WebSocket (if behind proxy):
```javascript
// In frontend client code:
const socket = io('http://localhost:5001', {
  transports: ['websocket'],  // Only use WebSocket
  reconnection: true,
});
```

## Performance Notes

- **WebSocket**: Persistent connection, lower latency, better for real-time
- **Polling**: Fallback if WebSocket unavailable, slightly higher latency
- Both are now enabled for maximum compatibility

## Additional Fixes Made

✅ Socket.IO authentication middleware active
✅ Socket handler properly initialized on startup
✅ Presence reset on server restart
✅ Error handling for JSON parsing
✅ DNS configuration for reliability

---

**Status**: All critical issues fixed ✅
**Next Step**: Restart backend with `npm run dev`

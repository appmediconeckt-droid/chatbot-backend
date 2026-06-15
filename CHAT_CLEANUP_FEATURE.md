# Chat Cleanup Feature - Implementation Guide

## Overview
Automatically deletes chat records and messages for users who have had **no contact with their counselor for 3+ months (90 days)**.

## What Gets Deleted?
✅ **All messages** - Text, images, files, and audio messages are CLEARED
❌ **Chat records** - Chat metadata is PRESERVED (for compliance/audit trail)
❌ **User data** - User accounts are NOT affected

## Implementation Details

### Files Created:
1. **`src/services/chatCleanupService.js`** - Core cleanup logic
2. **`src/jobs/chatCleanupJob.js`** - Cron job scheduler
3. **`src/routes/adminRoutes.js`** - Admin endpoints for manual cleanup

### Files Modified:
1. **`src/app.js`** - Added admin routes and job initialization

---

## Installation

### 1. Install node-cron dependency

```bash
npm install node-cron
```

### 2. Verify files are in place:
```
src/
├── services/
│   └── chatCleanupService.js (NEW)
├── jobs/
│   └── chatCleanupJob.js (NEW)
├── routes/
│   └── adminRoutes.js (NEW)
└── app.js (MODIFIED)
```

### 3. Restart your server
```bash
npm run dev
```

You should see:
```
✅ [ChatCleanupJob] Scheduled cleanup job initialized
   🕐 Runs every day at 2:00 AM
   ⏳ Clears chats inactive for 90+ days
```

---

## How It Works

### Automatic Cleanup (Daily at 2:00 AM)
- ✅ Automatically runs every day at 2:00 AM
- ✅ Identifies chats with NO messages in last 90 days
- ✅ Deletes messages first, then chat records
- ✅ Logs all actions to console

### Inactivity Detection Logic
A chat is considered **inactive** if:
```javascript
// Option 1: lastMessageAt is older than 90 days
Chat.lastMessageAt < (today - 90 days)

// Option 2: No messages ever + chat started 90+ days ago
Chat.lastMessageAt === null && Chat.startedAt < (today - 90 days)
```

---

## API Endpoints

### 1. Get Cleanup Statistics (Dry-Run)
```bash
POST /api/admin/cleanup/dry-run
Authorization: Bearer {token}

Response:
{
  "success": true,
  "message": "Dry-run results (nothing was deleted)",
  "data": {
    "wouldProcess": {
      "inactiveChats": 15,
      "messagesToDelete": 342
    },
    "note": "Only messages would be deleted, chat records will be preserved",
    "inactiveThreshold": "2026-03-17T14:22:00.000Z",
    "thresholdDays": 90,
    "timestamp": "2026-06-15T10:30:00.000Z"
  }
}
```

### 2. Get Cleanup Stats (Without Deleting)
```bash
GET /api/admin/cleanup/stats
Authorization: Bearer {token}

Response:
{
  "success": true,
  "message": "Cleanup statistics retrieved",
  "data": {
    "inactiveChatsCount": 15,
    "messagesCount": 342,
    "inactiveThreshold": "2026-03-17T14:22:00.000Z",
    "thresholdDays": 90,
    "lastUpdated": "2026-06-15T10:30:00.000Z"
  }
}
```

### 3. Execute Cleanup Now (Manual Trigger)
```bash
POST /api/admin/cleanup/execute
Authorization: Bearer {token}

Response:
{
  "success": true,
  "message": "Chat cleanup completed successfully",
  "data": {
    "chatsProcessed": 15,
    "messagesDeleted": 342,
    "note": "Chat records preserved, only messages cleared",
    "errors": [],
    "duration": 2345,
    "timestamp": "2026-06-15T10:30:00.000Z"
  }
}
```

---

## Testing

### Test 1: Check what would be deleted (No actual deletion)
```bash
curl -X POST http://localhost:5001/api/admin/cleanup/dry-run \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

### Test 2: Get current statistics
```bash
curl -X GET http://localhost:5001/api/admin/cleanup/stats \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Test 3: Actually execute cleanup
```bash
curl -X POST http://localhost:5001/api/admin/cleanup/execute \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

---

## Console Logs

### When Cleanup Runs Automatically (2 AM Daily):
```
============================================================
🔄 [ChatCleanupJob] Scheduled cleanup started at 2026-06-15T02:00:00.000Z
============================================================
🧹 [ChatCleanup] Starting cleanup for inactive chats (90 days)
   💾 Will delete messages only - chat records will be preserved

📊 [ChatCleanup] Found 15 inactive chats with no messages for 90+ days

  📝 Chat: chat_1718439600000_a1b2c3d4e
     User: 65a1b2c3d4e5f6g7h8i9j0k1 | Counselor: 65b2c3d4e5f6g7h8i9j0k1l2
     Last activity: 2/15/2026
     ✓ Cleared 23 messages from this chat

  [... more chats ...]

📈 [ChatCleanup] Cleanup completed:
   ✓ Chats processed: 15
   ✓ Messages deleted: 342
   ✓ Chat records: KEPT (not deleted)
   ⏱️  Duration: 2345ms

============================================================
```

---

## Configuration

### Change the Cleanup Schedule
Edit `src/jobs/chatCleanupJob.js` line 21:
```javascript
// Current: 2 AM every day
cron.schedule('0 2 * * *', async () => {

// Change to 3 AM:
cron.schedule('0 3 * * *', async () => {

// Change to every 6 hours:
cron.schedule('0 */6 * * *', async () => {
```

### Change the Inactivity Threshold
Edit `src/services/chatCleanupService.js` line 3:
```javascript
// Current: 90 days (3 months)
const INACTIVE_DAYS = 90;

// Change to 60 days (2 months):
const INACTIVE_DAYS = 60;

// Change to 180 days (6 months):
const INACTIVE_DAYS = 180;
```

---

## Important Notes

⚠️ **Role Requirements**
- Only users with `admin` or `superadmin` role can access cleanup endpoints
- Adjust in `adminRoutes.js` if you use different role names

⚠️ **Data Loss**
- Once deleted, chats and messages CANNOT be recovered
- Always run dry-run first to preview what will be deleted

⚠️ **Performance**
- Large cleanup operations (1000+ chats) may take several minutes
- Recommended to run during off-peak hours (hence 2 AM default)

⚠️ **User Notification**
- Users are NOT notified when their inactive chats are deleted
- Consider adding email notification logic if needed

---

## Troubleshooting

### Issue: Job not running at scheduled time
**Check:**
1. Is the server running? (`npm run dev`)
2. Check console for: `✅ [ChatCleanupJob] Scheduled cleanup job initialized`
3. Verify system time is correct

### Issue: "node-cron not found" error
**Fix:**
```bash
npm install node-cron
npm run dev
```

### Issue: Cleanup takes too long
**Check:**
1. How many inactive chats? (Use dry-run endpoint)
2. Database performance / connection speed
3. Consider increasing `INACTIVE_DAYS` to reduce cleanup volume

### Issue: Authorization errors on endpoints
**Check:**
1. Are you sending a valid JWT token in Authorization header?
2. Does the user have `admin` or `superadmin` role?
3. Check user's role in database

---

## Future Enhancements

Optional features to add later:
- [ ] Archive deleted chats to separate "deleted_chats" collection instead of permanent deletion
- [ ] Send email notifications to users before deleting their chats
- [ ] Email notifications to admins after cleanup
- [ ] Web dashboard to monitor cleanup history
- [ ] Whitelist certain chats to prevent deletion
- [ ] Configurable thresholds per user/counselor
- [ ] Backup chats before deletion (optional)

---

## Summary

✅ **Automatic**: Runs daily at 2 AM without manual intervention
✅ **Safe**: Dry-run option to preview before deletion
✅ **Logged**: Complete logging of all actions
✅ **Flexible**: Manual trigger + configurable schedule
✅ **Protected**: Admin-only access to endpoints
✅ **Simple**: One file to tweak settings

**3-Month Inactive Chat Cleanup** is now active! 🎉

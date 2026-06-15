# Chat Cleanup Feature - Quick Start ⚡

## What Was Implemented

✅ **Auto-delete messages** from chats inactive for 90+ days
✅ **Preserve chat records** (for audit trail/compliance)  
✅ **Daily automatic cleanup** at 2 AM
✅ **Admin endpoints** for manual control & preview
✅ **Complete logging** of all actions

---

## Setup (5 minutes)

### Step 1: Install dependency
```bash
npm install node-cron
```

### Step 2: Restart server
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

## Testing

### Test 1: Preview cleanup (DRY-RUN)
See what WILL be deleted WITHOUT actually deleting:

```bash
curl -X POST http://localhost:5001/api/admin/cleanup/dry-run \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Response Example:**
```json
{
  "success": true,
  "message": "Dry-run results (nothing was deleted)",
  "data": {
    "wouldProcess": {
      "inactiveChats": 5,
      "messagesToDelete": 87
    },
    "note": "Only messages would be deleted, chat records will be preserved",
    "inactiveThreshold": "2026-03-17T14:22:00.000Z",
    "thresholdDays": 90
  }
}
```

---

### Test 2: Get cleanup stats
See current statistics:

```bash
curl -X GET http://localhost:5001/api/admin/cleanup/stats \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Response Example:**
```json
{
  "success": true,
  "message": "Cleanup statistics retrieved",
  "data": {
    "inactiveChatsCount": 5,
    "messagesCount": 87,
    "inactiveThreshold": "2026-03-17T14:22:00.000Z",
    "thresholdDays": 90,
    "lastUpdated": "2026-06-15T10:30:00.000Z"
  }
}
```

---

### Test 3: Actually run cleanup
Execute the cleanup RIGHT NOW:

```bash
curl -X POST http://localhost:5001/api/admin/cleanup/execute \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Response Example:**
```json
{
  "success": true,
  "message": "Chat cleanup completed successfully",
  "data": {
    "chatsProcessed": 5,
    "messagesDeleted": 87,
    "note": "Chat records preserved, only messages cleared",
    "errors": [],
    "duration": 1234,
    "timestamp": "2026-06-15T10:30:00.000Z"
  }
}
```

Check **server console** to see detailed logs:
```
🧹 [ChatCleanup] Starting cleanup for inactive chats (90 days)
   💾 Will delete messages only - chat records will be preserved

📊 [ChatCleanup] Found 5 inactive chats with no messages for 90+ days

  📝 Chat: chat_1718439600000_abc123
     User: 65a1b2c3d4e5f6g7h8i9j0k1 | Counselor: 65b2c3d4e5f6g7h8i9j0k1l2
     Last activity: 2/15/2026
     ✓ Cleared 23 messages from this chat

📈 [ChatCleanup] Cleanup completed:
   ✓ Chats processed: 5
   ✓ Messages deleted: 87
   ✓ Chat records: KEPT (not deleted)
   ⏱️  Duration: 1234ms
```

---

## Automatic Cleanup

**Runs automatically every day at 2:00 AM**

You'll see in logs:
```
🔄 [ChatCleanupJob] Scheduled cleanup started at 2026-06-15T02:00:00.000Z
🧹 [ChatCleanup] Starting cleanup...
📈 [ChatCleanup] Cleanup completed:
   ✓ Chats processed: X
   ✓ Messages deleted: Y
```

---

## Configuration

### Change cleanup time (default: 2 AM)

Edit `src/jobs/chatCleanupJob.js` line 21:

**Current (2 AM every day):**
```javascript
cron.schedule('0 2 * * *', async () => {
```

**Examples:**
```javascript
// 3 AM
cron.schedule('0 3 * * *', async () => {

// Every 6 hours
cron.schedule('0 */6 * * *', async () => {

// Every Sunday at midnight
cron.schedule('0 0 * * 0', async () => {
```

### Change inactivity threshold (default: 90 days)

Edit `src/services/chatCleanupService.js` line 3:

**Current (90 days = 3 months):**
```javascript
const INACTIVE_DAYS = 90;
```

**Examples:**
```javascript
// 60 days (2 months)
const INACTIVE_DAYS = 60;

// 180 days (6 months)
const INACTIVE_DAYS = 180;

// 30 days (1 month)
const INACTIVE_DAYS = 30;
```

---

## Files Changed

```
✅ CREATED:
   • src/services/chatCleanupService.js (core logic)
   • src/jobs/chatCleanupJob.js (cron scheduler)
   • src/routes/adminRoutes.js (admin endpoints)

✅ MODIFIED:
   • src/app.js (added routes + job initialization)

📄 DOCUMENTATION:
   • CHAT_CLEANUP_FEATURE.md (detailed guide)
   • CHAT_CLEANUP_QUICK_START.md (this file)
```

---

## What Actually Happens

### For Each Inactive Chat:
1. ✅ Finds chats with **0 messages for 90+ days**
2. ✅ Deletes ALL messages in that chat
3. ✅ **KEEPS the chat record** (metadata preserved)
4. ✅ Logs the action

### Example:
**Before cleanup:**
```
Chat Record: chat_1718439600000_abc123
  - Status: active
  - User: 65a1b2c3d4e5f6g7h8i9j0k1
  - Messages: 87 documents
```

**After cleanup:**
```
Chat Record: chat_1718439600000_abc123 ← STILL EXISTS
  - Status: active
  - User: 65a1b2c3d4e5f6g7h8i9j0k1
  - Messages: 0 documents (all deleted)
```

---

## Important Notes

⚠️ **Requires Admin Role**
- Only users with `admin` or `superadmin` role can access endpoints
- Check user's role in database

⚠️ **Messages Are Permanent**
- Deleted messages CANNOT be recovered
- Always run dry-run first!

⚠️ **Chat Records Preserved**
- Chat metadata stays in database
- Good for compliance/audit trail
- Users can't see conversations (messages deleted)

⚠️ **Automatic Runs at 2 AM**
- Users won't be disrupted
- No manual action needed
- All actions logged

---

## Troubleshooting

### "node-cron not found"
```bash
npm install node-cron
npm run dev
```

### "Authorization error" on endpoints
- Check if user has admin role
- Verify JWT token is valid
- Check Authorization header format: `Bearer {token}`

### Cleanup takes too long
- Check how many messages need deletion
- Consider running during off-peak hours
- Database might be slow (check DB performance)

### Job not running at 2 AM
- Check server logs for: `✅ [ChatCleanupJob] Scheduled cleanup job initialized`
- Verify system time is correct
- Check MongoDB connection is stable

---

## Next Steps

1. ✅ Install node-cron
2. ✅ Restart server
3. ✅ Test dry-run endpoint
4. ✅ Monitor first automatic cleanup at 2 AM
5. ✅ Adjust configuration if needed

---

## Support

For detailed documentation, see: **CHAT_CLEANUP_FEATURE.md**

Questions? Ask in code comments or check the detailed guide! 🚀

# Chat Cleanup Feature - Deployment Checklist ✅

## Pre-Deployment Verification

### ✅ Files Created
- [ ] `src/services/chatCleanupService.js` - Core cleanup logic
- [ ] `src/jobs/chatCleanupJob.js` - Cron job scheduler
- [ ] `src/routes/adminRoutes.js` - Admin endpoints
- [ ] `test-chat-cleanup.js` - Test suite

### ✅ Files Modified
- [ ] `src/app.js` - Added imports and initialization

### ✅ Documentation
- [ ] `CHAT_CLEANUP_FEATURE.md` - Complete guide
- [ ] `CHAT_CLEANUP_QUICK_START.md` - Quick setup
- [ ] `RUN_CLEANUP_TEST.md` - Test instructions
- [ ] `CLEANUP_DEPLOYMENT_CHECKLIST.md` - This file

---

## Pre-Test Setup

### Step 1: Install Dependency
```bash
npm install node-cron
```
- [ ] Dependency installed successfully

### Step 2: Verify Files Exist
```bash
# Check all required files exist
ls -la src/services/chatCleanupService.js
ls -la src/jobs/chatCleanupJob.js
ls -la src/routes/adminRoutes.js
ls -la test-chat-cleanup.js
```
- [ ] All files exist

### Step 3: Verify Database Connection
```bash
# Make sure MongoDB is running and accessible
# Test connection string in src/.env
echo $MONGO_URI
```
- [ ] MongoDB is running
- [ ] Connection string is valid
- [ ] Database is accessible

### Step 4: Check Imports in app.js
Verify these lines are in `src/app.js`:
```javascript
import adminRoutes from "./routes/adminRoutes.js";
import { initChatCleanupJob } from "./jobs/chatCleanupJob.js";
```
- [ ] Imports added to app.js

### Step 5: Check Route Registration
Verify in `src/app.js`:
```javascript
app.use("/api/admin", adminRoutes);
```
- [ ] Admin routes registered

### Step 6: Check Job Initialization
Verify in `src/app.js` (after socketHandler):
```javascript
try {
  initChatCleanupJob();
} catch (error) {
  console.error("Failed to initialize chat cleanup job:", error);
}
```
- [ ] Job initialization added

---

## Test Execution

### Run the Test
```bash
node test-chat-cleanup.js
```

**Expected Output:**
- Connects to MongoDB ✅
- Creates test users ✅
- Creates 4 test chats (3 inactive, 1 active) ✅
- Gets cleanup statistics ✅
- Executes cleanup ✅
- Verifies results ✅
- Shows "ALL TESTS PASSED" ✅

- [ ] Test runs without errors
- [ ] All 6 tests pass
- [ ] Output shows "ALL TESTS PASSED"

---

## Post-Test Verification

### Test 1: Verify Cleanup Logic
Expected results after test:
- Inactive chats (100, 95, 90 days): Messages deleted ✅
- Active chat (today): Messages preserved ✅
- All chat records: Preserved ✅

- [ ] Inactive chat 1: 0 messages
- [ ] Inactive chat 2: 0 messages
- [ ] Active chat: 5 messages (unchanged)

### Test 2: Verify Cleanup Service Works
Check cleanup returned:
- `success: true`
- `chatsProcessed: 3+`
- `deletedMessages: 0+`
- `errors: []`

- [ ] Cleanup service executed successfully
- [ ] No errors reported

### Test 3: Verify Job Scheduling
When you run the server:
```bash
npm run dev
```

You should see:
```
✅ [ChatCleanupJob] Scheduled cleanup job initialized
   🕐 Runs every day at 2:00 AM
   ⏳ Clears chats inactive for 90+ days
```

- [ ] Job initialized message appears
- [ ] Job is scheduled

---

## Admin Endpoints Test

### Test Endpoint 1: Dry-Run
```bash
curl -X POST http://localhost:5001/api/admin/cleanup/dry-run \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "success": true,
  "message": "Dry-run results (nothing was deleted)",
  "data": {
    "wouldProcess": {
      "inactiveChats": 3,
      "messagesToDelete": 0
    },
    "note": "Only messages would be deleted, chat records will be preserved",
    ...
  }
}
```

- [ ] Endpoint returns 200 OK
- [ ] Shows correct count of inactive chats

### Test Endpoint 2: Get Stats
```bash
curl -X GET http://localhost:5001/api/admin/cleanup/stats \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Expected response:
```json
{
  "success": true,
  "message": "Cleanup statistics retrieved",
  "data": {
    "inactiveChatsCount": 3,
    "messagesCount": 0,
    ...
  }
}
```

- [ ] Endpoint returns 200 OK
- [ ] Stats match expected values

### Test Endpoint 3: Execute Cleanup
```bash
curl -X POST http://localhost:5001/api/admin/cleanup/execute \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "success": true,
  "message": "Chat cleanup completed successfully",
  "data": {
    "chatsProcessed": 3,
    "messagesDeleted": 0,
    "note": "Chat records preserved, only messages cleared",
    ...
  }
}
```

- [ ] Endpoint returns 200 OK
- [ ] Cleanup executed successfully
- [ ] Results match expected values

---

## Automatic Cleanup Test (Optional)

### Test Automatic Execution at 2 AM

1. **Start server:**
   ```bash
   npm run dev
   ```

2. **Check logs at 2 AM tomorrow:**
   - Should see cleanup logs automatically
   - Monitor for:
     ```
     🔄 [ChatCleanupJob] Scheduled cleanup started at ...
     🧹 [ChatCleanup] Starting cleanup...
     📈 [ChatCleanup] Cleanup completed:
     ```

3. **Verify no errors occurred**

- [ ] Server running at scheduled time
- [ ] Automatic cleanup executed
- [ ] No errors in logs

---

## Final Checklist Before Production

### Code Quality
- [ ] All files have been created
- [ ] All imports are correct
- [ ] No syntax errors
- [ ] Logging is appropriate

### Testing
- [ ] Unit test passes (test-chat-cleanup.js)
- [ ] All 6 tests passed
- [ ] Admin endpoints work
- [ ] No authorization issues

### Configuration
- [ ] Cleanup threshold: 90 days (correct)
- [ ] Job schedule: 2 AM daily (correct)
- [ ] Database connection: Working
- [ ] User model: Updated with test data

### Documentation
- [ ] All guide documents created
- [ ] Instructions are clear
- [ ] Examples provided

### Safety
- [ ] Messages only deleted (chat records preserved) ✅
- [ ] Active chats not affected ✅
- [ ] User data not deleted ✅
- [ ] Dry-run available for preview ✅

---

## Deployment Steps

### Step 1: Review Changes
```bash
git status
git diff src/app.js
```
- [ ] Review all changes

### Step 2: Commit Changes
```bash
git add .
git commit -m "feat: Add automatic chat cleanup for 90+ day inactive chats

- Clears messages from chats with no activity for 90+ days
- Preserves chat records for compliance
- Runs automatically daily at 2 AM
- Admin endpoints for manual control
- Comprehensive logging and error handling"
```
- [ ] Changes committed

### Step 3: Deploy to Production
```bash
# Merge to main
git checkout main
git merge cleanup-feature

# Deploy
git push origin main
```
- [ ] Changes pushed to production

### Step 4: Verify Production Deployment
```bash
# On production server
npm install
npm run dev
```

Check logs for:
```
✅ [ChatCleanupJob] Scheduled cleanup job initialized
   🕐 Runs every day at 2:00 AM
```

- [ ] Production deployment successful
- [ ] Job initialized

### Step 5: Monitor First Cleanup
- [ ] Monitor logs at next 2 AM
- [ ] Verify cleanup executed
- [ ] Check for any errors
- [ ] Confirm messages deleted, records preserved

---

## Rollback Plan (If Issues)

If anything goes wrong:

1. **Stop the cleanup job:**
   ```bash
   # Remove initChatCleanupJob() from src/app.js
   # Restart server
   ```

2. **Disable admin endpoints:**
   ```bash
   # Remove app.use("/api/admin", adminRoutes)
   # Restart server
   ```

3. **Restore deleted messages (if needed):**
   - You'll need MongoDB backups
   - This is why we have daily backups!

- [ ] Rollback procedure documented
- [ ] Backups in place

---

## Success Criteria ✅

Feature is successfully deployed when:

✅ All files created without errors
✅ Test suite passes (all 6 tests)
✅ Admin endpoints return correct responses
✅ Automatic job is initialized
✅ Production deployment is live
✅ First automatic cleanup runs at 2 AM
✅ Messages from inactive chats are deleted
✅ Chat records are preserved
✅ Active chats are unaffected
✅ No errors in logs

---

## Contact & Support

If you encounter issues:
1. Check the test output for specific errors
2. Review database logs
3. Check server logs for cleanup job output
4. Verify MongoDB connection
5. Re-read CHAT_CLEANUP_FEATURE.md

---

## Version Info

- **Feature**: Chat Cleanup (90+ day inactive)
- **Created**: 2026-06-15
- **Status**: Ready for testing
- **Test Suite**: test-chat-cleanup.js
- **Deployment**: Automated (node-cron)

Good luck! 🚀

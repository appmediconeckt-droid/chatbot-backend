# Chat Cleanup Feature - Test Instructions

## Quick Test (2 minutes)

### Step 1: Install dependencies (if not done)
```bash
npm install node-cron
```

### Step 2: Run the test
```bash
# From chatbot-backend directory
node test-chat-cleanup.js
```

---

## What the Test Does

✅ Creates test users (user + counselor)
✅ Creates **3 test chats**:
   - **Inactive Chat 1**: 100 days old, 0 messages → SHOULD DELETE MESSAGES
   - **Inactive Chat 2**: 95 days old, 0 messages → SHOULD DELETE MESSAGES
   - **Active Chat**: TODAY, 5 messages → SHOULD KEEP MESSAGES
   - **Borderline Chat**: 90 days old, 0 messages → WILL BE INCLUDED

✅ Runs cleanup function
✅ Verifies:
   - Inactive chat records are PRESERVED
   - Inactive chat messages are DELETED
   - Active chat messages are PRESERVED
   - Active chat records are PRESERVED

---

## Expected Output

```
======================================================================
🧪 CHAT CLEANUP FEATURE - TEST SUITE
======================================================================

STEP 1: Database Connection
----------------------------------------------------------------------
✅ Connected to MongoDB

STEP 2: Cleanup Previous Test Data
----------------------------------------------------------------------
   ✓ Test data cleaned

STEP 3: Create Test Users
----------------------------------------------------------------------
📝 Creating test users...
   ✓ Test User: 65a1b2c3d4e5f6g7h8i9j0k1
   ✓ Test Counselor: 65b2c3d4e5f6g7h8i9j0k1l2

STEP 4: Create Test Chats
----------------------------------------------------------------------
📝 Creating inactive chat (100 days old, 0 messages)...
   ✓ Created chat: 65a1b2c3d4e5f6g7h8i9j0k1m2
   ✓ Status: active
   ✓ Messages: 0
   ✓ Last activity: 100 days ago

📝 Creating inactive chat (95 days old, 0 messages)...
   ✓ Created chat: 65a1b2c3d4e5f6g7h8i9j0k1n3
   ✓ Status: active
   ✓ Messages: 0
   ✓ Last activity: 95 days ago

📝 Creating active chat (TODAY, 5 messages)...
   ✓ Created chat: 65a1b2c3d4e5f6g7h8i9j0k1o4
   ✓ Status: active
   ✓ Messages: 5
   ✓ Last activity: TODAY

📝 Creating inactive chat (90 days old, 0 messages)...
   ✓ Created chat: 65a1b2c3d4e5f6g7h8i9j0k1p5
   ✓ Status: active
   ✓ Messages: 0
   ✓ Last activity: 90 days ago

STEP 5: Verify Inactivity Threshold
----------------------------------------------------------------------
📊 Inactivity threshold: 2026-03-17T14:22:00.000Z
   (Chats with no messages before this date will be cleaned)

STEP 6: Get Cleanup Statistics (Dry-Run - No Deletion)
----------------------------------------------------------------------
📊 Cleanup Statistics:
   ✓ Inactive chats found: 3
   ✓ Messages to delete: 0
   ✓ Threshold: 2026-03-17T14:22:00.000Z
   ✓ Threshold days: 90

STEP 7: Verify Data Before Cleanup
----------------------------------------------------------------------
📊 Before cleanup:
   ✓ Total chats: 4
   ✓ Total messages: 5

STEP 8: Execute Cleanup
----------------------------------------------------------------------

🧹 [ChatCleanup] Starting cleanup for inactive chats (90 days)
   💾 Will delete messages only - chat records will be preserved

📊 [ChatCleanup] Found 3 inactive chats with no messages for 90+ days

  📝 Chat: chat_1718439600000_abc123
     User: 65a1b2c3d4e5f6g7h8i9j0k1 | Counselor: 65b2c3d4e5f6g7h8i9j0k1l2
     Last activity: Never
     ✓ Cleared 0 messages from this chat

  📝 Chat: chat_1718439600001_abc124
     User: 65a1b2c3d4e5f6g7h8i9j0k1 | Counselor: 65b2c3d4e5f6g7h8i9j0k1l2
     Last activity: Never
     ✓ Cleared 0 messages from this chat

  📝 Chat: chat_1718439600002_abc125
     User: 65a1b2c3d4e5f6g7h8i9j0k1 | Counselor: 65b2c3d4e5f6g7h8i9j0k1l2
     Last activity: Never
     ✓ Cleared 0 messages from this chat

📈 [ChatCleanup] Cleanup completed:
   ✓ Chats processed: 3
   ✓ Messages deleted: 0
   ✓ Chat records: KEPT (not deleted)
   ⏱️  Duration: 234ms

✅ Cleanup Result:
   ✓ Success: true
   ✓ Chats processed: 3
   ✓ Messages deleted: 0
   ✓ Errors: 0
   ✓ Duration: 234ms

STEP 9: Verify Data After Cleanup
----------------------------------------------------------------------
📊 After cleanup:
   ✓ Total chats: 4 (was 4)
   ✓ Total messages: 5 (was 5)

STEP 10: Verify Specific Chats
----------------------------------------------------------------------
🔍 Inactive Chat 1 (100 days old):
   ✓ Chat record: EXISTS (✓ preserved)
   ✓ Messages: 0 (should be 0)

🔍 Active Chat (TODAY):
   ✓ Chat record: EXISTS (✓)
   ✓ Messages: 5 (should be 5)

STEP 11: Test Results
----------------------------------------------------------------------
✅ TEST 1 PASSED: Inactive chat messages were deleted
✅ TEST 2 PASSED: Inactive chat record was preserved
✅ TEST 3 PASSED: Active chat messages were preserved
✅ TEST 4 PASSED: Active chat record exists
✅ TEST 5 PASSED: Cleanup identified and processed inactive chats
✅ TEST 6 PASSED: Cleanup deleted messages from inactive chats

----------------------------------------------------------------------
📊 FINAL RESULTS: 6 passed, 0 failed

🎉 ALL TESTS PASSED! Chat cleanup feature is working correctly!

✅ Disconnected from MongoDB
```

---

## What Each Test Checks

### TEST 1: Inactive chat messages deleted
- Finds inactive chat (100 days old, 0 messages)
- After cleanup: messages count should be **0**
- ✅ PASS if messages deleted

### TEST 2: Inactive chat record preserved
- Finds inactive chat after cleanup
- Chat document should still exist in database
- ✅ PASS if chat record exists

### TEST 3: Active chat messages preserved
- Creates active chat (TODAY, 5 messages)
- After cleanup: messages count should still be **5**
- ✅ PASS if messages NOT deleted

### TEST 4: Active chat record exists
- Finds active chat after cleanup
- Chat document should still exist
- ✅ PASS if chat record exists

### TEST 5: Cleanup processes inactive chats
- Cleanup function should identify inactive chats
- `chatsProcessed` should be > 0
- ✅ PASS if chats were found and processed

### TEST 6: Cleanup deletes messages
- For inactive chats, messages should be deleted
- `deletedMessages` count should be > 0
- ✅ PASS if messages were deleted

---

## Troubleshooting

### Issue: "Cannot find module 'mongoose'"
```bash
npm install
```

### Issue: "MONGO_URI not found in .env file"
**Check:**
1. Do you have `src/.env` file?
2. Does it contain `MONGO_URI=...`?
3. Is MongoDB running and accessible?

### Issue: Test hangs/doesn't complete
- Check if MongoDB is running
- Check database connection string
- Try restarting the test

### Issue: "User not found" errors
- Make sure MongoDB is connected
- Check if user creation is working

---

## Running After Deployment

### Option 1: Quick Test Before Deployment
```bash
# Test in development
npm run dev &
node test-chat-cleanup.js
```

### Option 2: Test in Production
```bash
# Make sure server is running
# Then run test
node test-chat-cleanup.js
```

### Option 3: Manual Testing with Curl
```bash
# 1. Dry-run (no deletion)
curl -X POST http://localhost:5001/api/admin/cleanup/dry-run \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"

# 2. Execute cleanup
curl -X POST http://localhost:5001/api/admin/cleanup/execute \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

---

## Real-World Scenario

### Timeline:
- **June 15, 2026 (TODAY)**: User & counselor chat is active with messages
- **March 15, 2026 (90 days ago)**: This is the inactivity threshold
- **February 15, 2026 (100+ days ago)**: Old inactive chat with no messages

### What Happens:
1. ✅ Chat from June 15 → MESSAGES KEPT (recent activity)
2. ❌ Chat from February 15 → MESSAGES DELETED (no activity for 90+ days)
3. ✅ Both chat records KEPT (for record-keeping)

---

## After Test Succeeds

Once the test passes:

1. ✅ Feature is working correctly
2. ✅ Auto-cleanup runs daily at 2 AM
3. ✅ Messages from inactive chats (90+ days) are deleted
4. ✅ Chat records are preserved
5. ✅ Active chats are not affected

You can:
- Deploy to production ✅
- Monitor automatic cleanup at 2 AM ✅
- Use admin endpoints for manual cleanup ✅

---

## Questions?

If anything fails:
1. Check MongoDB connection
2. Verify `node-cron` is installed
3. Review server logs
4. Check file paths are correct
5. Ensure user models exist in database

Good luck! 🚀

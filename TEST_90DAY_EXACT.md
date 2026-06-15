# 🎯 Test 90-Day Exact Threshold

## Quick Test

```bash
# Install + Test
npm install node-cron && node test-chat-cleanup.js
```

---

## What's Being Tested

### 5 Test Chats:
1. **100 days old** → Messages DELETED ✓
2. **95 days old** → Messages DELETED ✓
3. **EXACTLY 90 days old** → Messages DELETED ✓ (BOUNDARY)
4. **89 days old** → Messages KEPT ✓ (too recent)
5. **TODAY** → Messages KEPT ✓ (active)

### Key Test: 90-Day Boundary
```
Chat at 90 days: DELETED
Chat at 89 days: KEPT

Tests that threshold is EXACT, not fuzzy
```

---

## Expected Results

All 6 tests should PASS:

```
✅ TEST 1: Chat 100 days old - messages deleted
✅ TEST 2: Chat EXACTLY 90 days old - messages deleted (BOUNDARY ✓)
✅ TEST 3: Chat 89 days old - correctly NOT deleted (too recent)
✅ TEST 4: Active chat messages preserved
✅ TEST 5: All chat records preserved
✅ TEST 6: Cleanup processed 3+ chats

FINAL RESULTS: 6 passed, 0 failed
🎉 ALL TESTS PASSED!
```

---

## The Math

```
Today: June 15, 2026 at 2:00 PM
Exactly 90 days ago: March 17, 2026 at 2:00 PM

A chat from March 17 at 2:00:00 PM → DELETE (at threshold)
A chat from March 17 at 2:00:01 PM → KEEP (1 second fresher, <90 days)
A chat from March 16 → DELETE (older than threshold)
```

---

## Console Output Highlights

Look for:

```
📅 Threshold: Exactly 90 days (90d calculated)
📆 Today: 2026-06-15
📆 Cutoff: 2026-03-17

📝 Chat: chat_xxx
   Last activity: 2026-03-17 (100 days ago)
   Exceeds threshold: ✓ YES
   ✓ Cleared X messages

STEP 11: Test Results - EXACT 90-DAY THRESHOLD
✅ TEST 2 PASSED: Chat EXACTLY 90 days old - deleted (BOUNDARY ✓)
✅ TEST 3 PASSED: Chat 89 days old - NOT deleted (too recent)
```

---

## Verification Points

### Before Cleanup:
- 5 test chats created
- 4 are inactive (different ages)
- 1 is active (today with messages)

### After Cleanup:
- Chats ≥90 days: Messages deleted
- Chats <90 days: Messages kept
- All chat records: Preserved
- Active chat: Completely protected

### Boundary Check:
- 90 days exactly → Included in cleanup ✓
- 89 days → Not included ✓
- Clear distinction ✓

---

## Success Criteria

✅ Test runs without errors
✅ All 6 tests show "PASSED"
✅ Boundary test works (90=DELETE, 89=KEEP)
✅ Output shows exact date calculations
✅ No error messages in logs

---

## If Test Fails

### Common Issues:

**"Cannot find module"**
```bash
npm install
```

**"Cannot connect to MongoDB"**
- Check MongoDB is running
- Check MONGO_URI in src/.env

**Test hangs**
- Check database connection
- Ctrl+C and retry

---

## Real-World Verification

### In Production (at 2 AM):
You should see in logs:
```
🧹 [ChatCleanup] Starting cleanup for inactive chats
   📅 Threshold: Exactly 90 days
   📆 Today: 2026-06-20
   📆 Cutoff: 2026-03-22

📊 Found 15 chats with NO messages for exactly 90+ days
   ✓ Chat 1: Last activity 2026-03-10 (101 days ago) - DELETE
   ✓ Chat 2: Last activity 2026-03-20 (92 days ago) - DELETE
   ✓ Chat 3: Last activity 2026-03-22 (90 days ago) - DELETE
   ✓ Chat 4: Last activity 2026-03-25 (87 days ago) - KEEP

Cleanup completed:
   ✓ Chats processed: 3
   ✓ Messages deleted: 127
   ✓ Chat records: KEPT
```

---

## 30-Second Summary

```bash
# Run this:
npm install node-cron && node test-chat-cleanup.js

# You should see:
✅ TEST 2 PASSED: Chat EXACTLY 90 days old - messages deleted (BOUNDARY ✓)
✅ TEST 3 PASSED: Chat 89 days old - correctly NOT deleted (too recent)

# This means:
✓ Exact 90-day threshold working
✓ Boundary protection working
✓ Feature ready for production
```

---

## That's It! 🎉

Test confirms:
- ✓ Exactly 90 days triggers cleanup
- ✓ 89 days is protected
- ✓ Active chats safe
- ✓ Chat records preserved
- ✓ Production ready

Run the test and confirm all 6 pass! ✅

# Rating Eligibility Feature - Complete Analysis

## Executive Summary
Your rating feature has **DUAL implementations**:
1. ✅ **NEW (Correct)**: Eligibility-based rating in RatingPrompt (20 messages OR 5-min call, 48h delay)
2. ⚠️ **OLD (Deprecated)**: Immediate post-session rating in ChatBox.jsx (using deprecated service shims)

---

## BACKEND IMPLEMENTATION ✅ CORRECT

### 1. Eligibility Rules (ratingEligibilityService.js)
**Thresholds:**
- `MIN_CHAT_MESSAGES = 20` (exchanged messages with counselor)
- `MIN_CALL_SECONDS = 300` (5 minutes)
- `ELIGIBLE_DELAY_MS = 48 hours` (wait before showing popup)
- `REMIND_LATER_MS = 7 days` (snooze period)

**Logic:**
A (user, counselor) pair becomes eligible when **EITHER**:
- ✅ They exchanged ≥20 chat messages, OR
- ✅ They had a video call ≥5 minutes long

After meeting either criterion, popup is scheduled for `lastInteraction + 48 hours`.

### 2. API Endpoints (ratingsApiRoutes.js)
All endpoints enforce backend rules:

| Endpoint | Method | Purpose | Enforces |
|----------|--------|---------|----------|
| `/api/ratings/check-eligibility` | GET | Check if user should see rating popup | 20 msgs/5 min + 48h delay |
| `/api/ratings/submit` | POST | Submit rating | One per (user, counselor) pair |
| `/api/ratings/remind-later` | POST | Hide popup for 7 days | Business rule |
| `/api/ratings/never-ask-again` | POST | Permanently hide popup | Business rule |

### 3. RatingStatus Model (tracks per user-counselor pair)
```javascript
{
  counselorId,           // Who user rated
  userId,               // Who rated
  eligibleAt,           // When popup should show (null = not eligible)
  eligibleReason,       // "chat" or "call"
  lastInteractionAt,    // Timestamp of qualifying interaction
  hasRated,             // true = submitted rating, popup never shows again
  remindLaterUntil,     // If set, suppress until this date
  neverAskAgain,        // true = permanently suppress
}
```

### 4. Rating Model (stores submitted ratings)
- One rating per (user, counselor) pair (enforced by unique index)
- Includes: stars (1-5), comment, counselorId, userId
- Prevents duplicate submissions

---

## FRONTEND IMPLEMENTATION 🔄 MIXED

### ✅ NEW (Correct) - RatingPrompt Flow

**File:** `chatbot-app/src/components/RatingPrompt.jsx`

**What it does:**
1. Mounts in UserDashboard shell (line 1666)
2. Every time `triggerKey` changes (active tab), calls backend `/api/ratings/check-eligibility`
3. If eligible: shows RatingModal
4. Handles 3 user actions:
   - **Submit** → calls `/api/ratings/submit` (marks user.hasRated = true)
   - **Remind later** → calls `/api/ratings/remind-later` (snoozes 7 days)
   - **Never ask** → calls `/api/ratings/never-ask-again` (permanent suppress)

**Correctly implements:**
- ✅ Waits for backend to decide eligibility (20 msgs/5 min + 48h)
- ✅ Respects user choices (never shows if `hasRated` or `neverAskAgain`)
- ✅ One popup at a time (oldest-eligible first)
- ✅ Enforces one rating per counselor

### ⚠️ OLD (Deprecated) - ChatBox.jsx Flow

**File:** `chatbot-app/src/screens/user/Component/UserDashboard/Tab/ChatBox/ChatBox.jsx`

**What it tries to do:**
1. Show RatingModal immediately after session ends
2. Track pending ratings (savePendingRating)
3. Re-prompt on next visit (getDuePendingRating)
4. Prevent leaving chat without rating

**Problem:**
- Uses deprecated service methods (lines 77-92 in ratingService.js):
  ```javascript
  export async function savePendingRating() {}        // NO-OP
  export async function getDuePendingRating() { return null; }  // NO-OP
  export async function isAlreadyRated() { return true; }       // NO-OP
  ```
- These return empty/null, so ChatBox logic doesn't work
- **Result:** Old immediate rating prompts don't trigger

---

## ✅ WHAT WORKS (Correctly)

1. **Eligibility Calculation**
   - Backend computes 20 messages OR 5-minute calls correctly
   - 48-hour delay properly enforced
   - RatingStatus properly tracks per-pair state

2. **Duplicate Prevention**
   - Only one rating per (user, counselor) pair
   - Backend rejects second attempts with 409 error
   - hasRated flag prevents popup re-showing

3. **User Choice Respect**
   - "Never ask again" sets `neverAskAgain = true` (permanent)
   - "Remind later" sets `remindLaterUntil = now + 7 days`
   - Both options properly prevent future prompts

4. **RatingPrompt Integration**
   - Correctly mounted in UserDashboard
   - Triggers on tab/screen changes (via `triggerKey`)
   - Fetches fresh eligibility from backend each time

5. **Star Rating & Review**
   - 1-5 star selector (interactive component works)
   - Optional review text (0-500 chars)
   - Success message after submit

---

## ⚠️ ISSUES FOUND

### Issue #1: ChatBox.jsx Old Rating Logic is Dead
**Severity:** LOW (non-functional, but clutters code)

- Lines 262-625: Old rating popup logic tries to show immediately
- Uses deprecated ratingService methods (savePendingRating, getDuePendingRating)
- These are no-ops, so popup never shows
- **Example affected code:**
  ```javascript
  await ratingService.savePendingRating(target);  // Does nothing
  const due = await ratingService.getDuePendingRating();  // Returns null
  if (alreadyRatedCounselor || ratingPromptedRef.current)  // Always true
  ```

**Impact:**
- ❌ Doesn't prevent users from leaving chat without rating
- ❌ Doesn't show rating prompt immediately after session
- ✅ But proper eligibility-based rating still works via RatingPrompt

---

## 🔍 API Flow Verification

### Correct Flow: User rates after meeting eligibility
```
1. User exchanges 20+ messages with counselor
2. Message is saved to Message collection
3. User navigates away from chat (to dashboard)
4. Dashboard mounts RatingPrompt
5. RatingPrompt calls GET /api/ratings/check-eligibility
6. Backend:
   - Calls refreshUserRatingEligibility() to recompute
   - Checks Chat/Message counts (≥20 messages)
   - Sets eligibleAt = now + 48 hours
   - Returns { showPopup: true, counselorId, counselorName, ... }
7. RatingPrompt shows RatingModal
8. User submits rating (1-5 stars + optional review)
9. RatingPrompt calls POST /api/ratings/submit
10. Backend:
    - Verifies user is not role="counsellor"
    - Verifies pair is eligible (eligibleAt <= now)
    - Verifies hasn't already rated (checks hasRated + Rating records)
    - Creates Rating record
    - Updates User.rating aggregate (avg of all ratings)
    - Sets RatingStatus.hasRated = true
11. Modal shows "Thank you!" success message
12. RatingPrompt closes
13. Popup never shows for this pair again
```

---

## RECOMMENDATIONS

### What to Keep ✅
1. **RatingPrompt component** - Properly implements eligibility rules
2. **Backend ratingEligibilityService** - Correct thresholds (20 msgs, 5 min, 48h)
3. **ratingsApiRoutes endpoints** - All enforcement is server-side
4. **RatingStatus model** - Proper tracking of user decisions

### What to Remove/Fix ⚠️
1. **ChatBox.jsx old rating logic** (lines 262-625):
   - Remove savePendingRating calls (line 491, 533)
   - Remove getDuePendingRating logic (lines 545-558)
   - Remove handleBackNavigation (lines 497-527)
   - Remove beforeRemove listener (lines 561-585)
   - Keep only the new eligibility-based flow
   
2. **Deprecated ratingService shims** (lines 77-92):
   - These are fine as-is (compatibility shims)
   - They prevent older code from crashing
   - Can leave them permanently

---

## Testing Checklist

### Backend Tests
- [ ] Verify 20 chat messages triggers eligibility
- [ ] Verify 5-minute call triggers eligibility
- [ ] Verify 48-hour delay blocks early popup
- [ ] Verify one rating per (user, counselor) pair blocks duplicates
- [ ] Verify "never ask again" works permanently
- [ ] Verify "remind later" blocks for exactly 7 days

### Frontend Tests
- [ ] RatingPrompt shows popup only when eligible
- [ ] Can submit 1-5 stars + optional review
- [ ] "Remind me later" hides popup for 7 days
- [ ] "Never ask again" hides popup permanently
- [ ] Closing (X button) defaults to "remind later"
- [ ] Multiple counselors show one at a time (oldest first)

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Backend Eligibility | ✅ CORRECT | 20 messages OR 5-minute calls, 48-hour delay |
| Backend APIs | ✅ CORRECT | All endpoints enforce rules server-side |
| RatingPrompt (new) | ✅ CORRECT | Properly checks eligibility on mount |
| ChatBox (old) | ⚠️ DEAD CODE | Uses deprecated no-op service methods |
| RatingStatus model | ✅ CORRECT | Tracks user decisions properly |
| Rating model | ✅ CORRECT | Prevents duplicates with unique index |

**Overall:** Feature works correctly. Old code in ChatBox should be removed to avoid confusion.

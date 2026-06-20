#!/bin/bash

echo "🔍 Rating Feature Setup Verification"
echo "===================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter
PASSED=0
FAILED=0

# Check 1: Rating routes file exists
echo -n "✓ Checking ratingRoutes.js... "
if [ -f "src/routes/ratingRoutes.js" ]; then
  echo -e "${GREEN}FOUND${NC}"
  ((PASSED++))
else
  echo -e "${RED}MISSING${NC}"
  ((FAILED++))
fi

# Check 2: Rating API routes file exists
echo -n "✓ Checking ratingsApiRoutes.js... "
if [ -f "src/routes/ratingsApiRoutes.js" ]; then
  echo -e "${GREEN}FOUND${NC}"
  ((PASSED++))
else
  echo -e "${RED}MISSING${NC}"
  ((FAILED++))
fi

# Check 3: Rating controller exists
echo -n "✓ Checking ratingController.js... "
if [ -f "src/controllers/ratingController.js" ]; then
  echo -e "${GREEN}FOUND${NC}"
  ((PASSED++))
else
  echo -e "${RED}MISSING${NC}"
  ((FAILED++))
fi

# Check 4: Rating eligibility service exists
echo -n "✓ Checking ratingEligibilityService.js... "
if [ -f "src/services/ratingEligibilityService.js" ]; then
  echo -e "${GREEN}FOUND${NC}"
  ((PASSED++))
else
  echo -e "${RED}MISSING${NC}"
  ((FAILED++))
fi

# Check 5: Rating model exists
echo -n "✓ Checking Rating.js model... "
if [ -f "src/models/Rating.js" ]; then
  echo -e "${GREEN}FOUND${NC}"
  ((PASSED++))
else
  echo -e "${RED}MISSING${NC}"
  ((FAILED++))
fi

# Check 6: RatingStatus model exists
echo -n "✓ Checking RatingStatus.js model... "
if [ -f "src/models/RatingStatus.js" ]; then
  echo -e "${GREEN}FOUND${NC}"
  ((PASSED++))
else
  echo -e "${RED}MISSING${NC}"
  ((FAILED++))
fi

# Check 7: Routes mounted in app.js
echo -n "✓ Checking routes mounted in app.js... "
if grep -q 'ratingsApiRoutes\|ratingRoutes' src/app.js; then
  echo -e "${GREEN}MOUNTED${NC}"
  ((PASSED++))
else
  echo -e "${RED}NOT MOUNTED${NC}"
  ((FAILED++))
fi

# Check 8: Eligibility constants
echo -n "✓ Checking eligibility constants... "
if grep -q 'MIN_CHAT_MESSAGES.*=.*20' src/services/ratingEligibilityService.js; then
  echo -e "${GREEN}20 MESSAGES${NC}"
  ((PASSED++))
else
  echo -e "${RED}INCORRECT${NC}"
  ((FAILED++))
fi

echo ""
echo "===================================="
echo -e "Results: ${GREEN}${PASSED} PASSED${NC} | ${RED}${FAILED} FAILED${NC}"
echo "===================================="

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Start backend: npm run dev"
  echo "2. Verify logs show: ✅ Server running on port 5001"
  echo "3. Run frontend: npm start"
  echo "4. Follow testing instructions in RATING_FEATURE_TEST_REPORT.md"
  exit 0
else
  echo -e "${RED}❌ Some checks failed!${NC}"
  echo "Please verify the files exist and are properly configured."
  exit 1
fi

#!/bin/bash
# End-to-end API test script for KitchenAI backend
# Usage: ./test_api.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:8080

BASE_URL="${1:-http://localhost:8080}"
API="$BASE_URL/api/v1"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

check() {
  local name="$1" code="$2" expected="$3"
  if [ "$code" -eq "$expected" ]; then
    green "  PASS  $name (HTTP $code)"
    PASS=$((PASS + 1))
  else
    red "  FAIL  $name (HTTP $code, expected $expected)"
    FAIL=$((FAIL + 1))
  fi
}

bold "=== KitchenAI API Tests ==="
bold "Target: $BASE_URL"
echo ""

# ─── Health ───────────────────────────────────────────────────
bold "1. Health Check"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
check "GET /health" "$CODE" 200

# ─── Auth (mock login in dev mode) ───────────────────────────
bold "2. Auth - Google Login (mock)"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/auth/google-login" \
  -H "Content-Type: application/json" \
  -d '{"credential":"mock-token"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "POST /auth/google-login" "$CODE" 200

TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  red "  Could not extract token. Remaining tests may fail."
else
  green "  Token obtained: ${TOKEN:0:20}..."
fi
AUTH="Authorization: Bearer $TOKEN"

# ─── Auth - Me ────────────────────────────────────────────────
bold "3. Auth - Me"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/auth/me")
check "GET /auth/me" "$CODE" 200

# ─── Inventory CRUD ──────────────────────────────────────────
bold "4. Inventory - List"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/inventory")
check "GET /inventory" "$CODE" 200

bold "5. Inventory - Create"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/inventory" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"canonical_name":"Test Milk","qty":2,"unit":"liters","estimated_expiry":"2026-05-20","is_manual":true}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "POST /inventory" "$CODE" 201
ITEM_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('item_id',''))" 2>/dev/null)

if [ -n "$ITEM_ID" ]; then
  bold "6. Inventory - Get Single"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/inventory/$ITEM_ID")
  check "GET /inventory/$ITEM_ID" "$CODE" 200

  bold "7. Inventory - Update"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/inventory/$ITEM_ID" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"canonical_name":"Test Milk Updated","qty":3,"unit":"liters","is_manual":true}')
  check "PUT /inventory/$ITEM_ID" "$CODE" 200

  bold "8. Inventory - Delete"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/inventory/$ITEM_ID" -H "$AUTH")
  check "DELETE /inventory/$ITEM_ID" "$CODE" 200
fi

# ─── Expiring Items ──────────────────────────────────────────
bold "9. Expiring Items"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/inventory/expiring")
check "GET /inventory/expiring" "$CODE" 200

# ─── User Preferences ────────────────────────────────────────
bold "10. User Preferences - Get"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/user/preferences")
check "GET /user/preferences" "$CODE" 200

bold "11. User Preferences - Update"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/user/preferences" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"dislikes":["brinjal"],"dietary_tags":["vegetarian"],"fav_cuisines":["indian","italian"]}')
check "PUT /user/preferences" "$CODE" 200

# ─── Cook Profile ────────────────────────────────────────────
bold "12. Cook Profile - Get"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/cook/profile")
check "GET /cook/profile" "$CODE" 200

bold "13. Cook Profile - Update"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/cook/profile" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"dishes_known":["paneer butter masala","dal tadka","roti"],"preferred_lang":"hi","phone_number":"+919876543210"}')
check "PUT /cook/profile" "$CODE" 200

# ─── Bill Scan (Test endpoint) ───────────────────────────────
bold "14. Bill Scan - Test"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/bill/scan/test")
check "GET /bill/scan/test" "$CODE" 200

# ─── Rescue Meals ────────────────────────────────────────────
bold "15. Rescue Meals - Suggestions"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/rescue-meal/suggestions")
check "GET /rescue-meal/suggestions" "$CODE" 200

bold "16. Rescue Meals - Simple"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/rescue-meal/simple")
check "GET /rescue-meal/simple" "$CODE" 200

# ─── Procurement ─────────────────────────────────────────────
bold "17. Procurement - Summary"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/procurement/summary")
check "GET /procurement/summary" "$CODE" 200

bold "18. Procurement - Low Stock"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/procurement/low-stock")
check "GET /procurement/low-stock" "$CODE" 200

bold "19. Procurement - Shopping List"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/procurement/shopping-list" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"include_low_stock":true,"include_expiring":true,"max_items":10}')
check "POST /procurement/shopping-list" "$CODE" 200

# ─── WhatsApp (test mode) ────────────────────────────────────
bold "20. WhatsApp - Test Integration"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/whatsapp/test")
check "GET /whatsapp/test" "$CODE" 200

# ─── Logout ──────────────────────────────────────────────────
bold "21. Auth - Logout"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/logout" -H "$AUTH")
check "POST /auth/logout" "$CODE" 200

# ─── Summary ─────────────────────────────────────────────────
echo ""
bold "=== Results ==="
green "  Passed: $PASS"
if [ "$FAIL" -gt 0 ]; then
  red "  Failed: $FAIL"
else
  green "  Failed: $FAIL"
fi
echo ""

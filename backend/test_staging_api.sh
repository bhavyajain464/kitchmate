#!/usr/bin/env bash
# Run the HTTP API contract suite (defaults to local API on :8080).
#
# Usage:
#   ./test_staging_api.sh
#   STAGING_BASE_URL=staging ./test_staging_api.sh
#
# Local defaults: LLM + admin-write + deep journeys enabled; restaurant / side-effects skipped.
#
# Blockers you may need to resolve for full coverage:
#   ADMIN_API_KEY          — set in backend/.env (same value the API process loads), restart API
#   STAGING_INCLUDE_RESTAURANT=1 — opt into partner/restaurant API tests
#   STAGING_RESTAURANT_KITCHEN_ID — only if the test user has no restaurant kitchen yet
#   STAGING_INCLUDE_SIDE_EFFECTS=1 — diet email send-test + panel push send
#
# Opt out: STAGING_INCLUDE_LLM=0  STAGING_INCLUDE_ADMIN_WRITE=0  STAGING_INCLUDE_DEEP=0

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export STAGING_BASE_URL="${STAGING_BASE_URL:-http://localhost:8080}"

echo "=== API suite ==="
echo "Target: $STAGING_BASE_URL"
echo ""

exec go test -tags=staging ./tests/stagingapi/ -count=1 -v -timeout "${STAGING_TEST_TIMEOUT:-20m}" "$@"

//go:build staging

// Package stagingapi is an HTTP contract suite against the local (or staging) API.
//
// Run:
//
//	cd backend && ./test_staging_api.sh
//
// Defaults to http://localhost:8080. Use STAGING_BASE_URL=staging for Cloud Run staging.
//
// Auth (one of):
//   - STAGING_AUTH_TOKEN — Bearer session JWT
//   - DATABASE_URL (+ optional STAGING_USER_ID, SESSION_TOKEN_SECRET) — mint a session
//     On localhost, STAGING_USER_ID may be omitted (first user in DB is used).
//
// Optional:
//   - ADMIN_API_KEY — enables /admin/* checks
//   - STAGING_INCLUDE_RESTAURANT=1 — opt into partner/restaurant kitchen tests
//   - STAGING_RESTAURANT_KITCHEN_ID — restaurant kitchen when restaurant suite is enabled
//   - STAGING_INCLUDE_LLM=1 — hit LLM-backed routes (meal refresh, bill scan, etc.)
//   - STAGING_INCLUDE_ADMIN_WRITE=1 — allow mutating admin routes
//   - STAGING_BASE_URL — override base URL
package stagingapi

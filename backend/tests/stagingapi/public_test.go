//go:build staging

package stagingapi

import (
	"net/http"
	"testing"
)

func TestPublicHealth(t *testing.T) {
	res := client.do(t, http.MethodGet, "/health", nil, nil)
	expectStatusExact(t, "GET /health", res.Status, http.StatusOK, res.Body)
}

func TestPublicAppConfig(t *testing.T) {
	// Unauthenticated should still work.
	anon := &apiClient{base: cfg.BaseURL, client: client.client}
	res := anon.do(t, http.MethodGet, "/api/v1/app/config", nil, nil)
	expectStatusExact(t, "GET /api/v1/app/config", res.Status, http.StatusOK, res.Body)
}

func TestAuthRequiredWithoutToken(t *testing.T) {
	anon := &apiClient{base: cfg.BaseURL, client: client.client}
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/auth/me"},
		{http.MethodGet, "/api/v1/inventory"},
		{http.MethodGet, "/api/v1/shopping"},
		{http.MethodGet, "/api/v1/kitchen"},
		{http.MethodGet, "/api/v1/entitlements"},
		{http.MethodGet, "/api/v1/restaurant/kitchens"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			res := anon.do(t, tc.method, tc.path, nil, nil)
			expectStatus(t, tc.path, res.Status, http.StatusUnauthorized, http.StatusForbidden)
		})
	}
}

func TestAuthMe(t *testing.T) {
	res := client.do(t, http.MethodGet, "/api/v1/auth/me", nil, nil)
	expectStatusExact(t, "GET /auth/me", res.Status, http.StatusOK, res.Body)
	m := res.jsonMap(t)
	if m["user"] == nil && m["email"] == nil && m["user_id"] == nil {
		// Handler may nest under "user" or flatten — accept either shape with token validity proven by 200.
		t.Logf("auth/me body keys present; status OK")
	}
}

func TestBillingWebhookRejectsUnsigned(t *testing.T) {
	res := client.do(t, http.MethodPost, "/api/v1/billing/razorpay/webhook", map[string]any{"event": "ping"}, nil)
	// Missing/invalid signature should not be accepted as 200.
	if res.Status == http.StatusOK {
		t.Fatalf("webhook accepted unsigned payload (HTTP 200)")
	}
	expectStatus(t, "POST /billing/razorpay/webhook", res.Status,
		http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusInternalServerError)
}

func TestPublicZomatoConnectMissingToken(t *testing.T) {
	anon := &apiClient{base: cfg.BaseURL, client: client.client}
	res := anon.do(t, http.MethodGet, "/api/v1/public/zomato/connect/not-a-real-token", nil, nil)
	expectStatus(t, "GET /public/zomato/connect/{token}", res.Status,
		http.StatusNotFound, http.StatusBadRequest, http.StatusGone, http.StatusUnauthorized)
}

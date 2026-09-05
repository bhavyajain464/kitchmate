//go:build staging

package stagingapi

import (
	"net/http"
	"testing"
)

func TestAdminUnauthorizedWithoutKey(t *testing.T) {
	anon := &apiClient{base: cfg.BaseURL, token: client.token, client: client.client}
	res := anon.do(t, http.MethodGet, "/api/v1/admin/catalog/pair-aliases", nil, nil)
	// Missing/disabled admin key: 401/403/404, or 503 when admin routes are not configured.
	expectStatus(t, "GET /admin/catalog/pair-aliases without key", res.Status,
		http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusServiceUnavailable)
}

func TestAdminReads(t *testing.T) {
	skipIfNoAdmin(t)
	res := client.doAdmin(t, http.MethodGet, "/api/v1/admin/catalog/pair-aliases", nil)
	expectStatusExact(t, "GET /admin/catalog/pair-aliases", res.Status, http.StatusOK, res.Body)
}

func TestAdminWrites(t *testing.T) {
	skipIfNoAdmin(t)
	skipUnlessAdminWrite(t)

	clear := client.doAdmin(t, http.MethodPost, "/api/v1/admin/meal-of-day/clear-cache", map[string]any{})
	expectStatus(t, "POST /admin/meal-of-day/clear-cache", clear.Status,
		http.StatusOK, http.StatusNoContent)

	// Pair-alias roundtrip: bill-scan style misspelling → catalog canonical.
	tomato := resolveCatalogName(t, "Tomato")
	label := "tmto"
	create := client.doAdmin(t, http.MethodPost, "/api/v1/admin/catalog/pair-aliases", map[string]any{
		"label":          label,
		"canonical_name": tomato,
	})
	expectStatus(t, "POST /admin/catalog/pair-aliases", create.Status,
		http.StatusOK, http.StatusCreated, http.StatusConflict, http.StatusBadRequest)

	del := client.doAdmin(t, http.MethodDelete, "/api/v1/admin/catalog/pair-aliases", map[string]any{
		"label": label,
	})
	expectStatus(t, "DELETE /admin/catalog/pair-aliases", del.Status,
		http.StatusOK, http.StatusNoContent, http.StatusNotFound, http.StatusBadRequest)
}

func TestPanelAccess(t *testing.T) {
	// Panel returns 200 for allowlisted emails, 404 for everyone else (intentional hide).
	res := client.do(t, http.MethodGet, "/api/v1/panel/access", nil, nil)
	expectStatus(t, "GET /panel/access", res.Status, http.StatusOK, http.StatusNotFound, http.StatusForbidden)

	if res.Status != http.StatusOK {
		t.Skip("session user is not on ADMIN_PANEL_EMAILS — panel routes hidden")
	}

	aliases := client.do(t, http.MethodGet, "/api/v1/panel/catalog/pair-aliases", nil, nil)
	expectStatusExact(t, "GET /panel/catalog/pair-aliases", aliases.Status, http.StatusOK, aliases.Body)
}

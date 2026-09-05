//go:build staging

package stagingapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
)

var (
	cfg    envConfig
	client *apiClient
)

func TestMain(m *testing.M) {
	loadDotEnv()
	cfg = loadEnv()

	token, err := resolveAuthToken(cfg)
	if err != nil {
		_, _ = os.Stderr.WriteString("stagingapi setup failed: " + err.Error() + "\n")
		_, _ = os.Stderr.WriteString("Provide STAGING_AUTH_TOKEN, or DATABASE_URL (+ optional STAGING_USER_ID / SESSION_TOKEN_SECRET).\n")
		os.Exit(1)
	}

	client = &apiClient{
		base:  cfg.BaseURL,
		token: token,
		admin: cfg.AdminAPIKey,
		client: &http.Client{
			Timeout: cfg.HTTPTimeout,
		},
	}

	discoverRestaurantKitchen()
	printSetupSummary()
	os.Exit(m.Run())
}

func discoverRestaurantKitchen() {
	if !cfg.IncludeRestaurant {
		return
	}
	if cfg.RestaurantKitchenID != "" {
		return
	}
	// Prefer an existing membership for the session user.
	res := (&apiClient{base: cfg.BaseURL, token: client.token, client: client.client}).doSilent(http.MethodGet, "/api/v1/restaurant/kitchens", nil, nil)
	if res.Status != http.StatusOK {
		return
	}
	var kitchens []struct {
		KitchenID string `json:"kitchen_id"`
		Role      string `json:"role"`
		Name      string `json:"name"`
	}
	if err := json.Unmarshal(res.Body, &kitchens); err != nil || len(kitchens) == 0 {
		return
	}
	cfg.RestaurantKitchenID = kitchens[0].KitchenID
	_, _ = fmt.Fprintf(os.Stderr, "stagingapi restaurant kitchen: auto-selected %s (%s)\n", kitchens[0].KitchenID, kitchens[0].Name)
}

func printSetupSummary() {
	_, _ = os.Stderr.WriteString("stagingapi target: " + cfg.BaseURL + "\n")
	_, _ = os.Stderr.WriteString("stagingapi auth: session token ready\n")
	if cfg.AdminAPIKey != "" {
		_, _ = os.Stderr.WriteString("stagingapi admin: ADMIN_API_KEY set\n")
	}
	if cfg.IncludeRestaurant {
		_, _ = os.Stderr.WriteString("stagingapi restaurant: enabled\n")
		if cfg.RestaurantKitchenID != "" {
			_, _ = os.Stderr.WriteString("stagingapi restaurant kitchen: " + cfg.RestaurantKitchenID + "\n")
		}
	} else {
		_, _ = os.Stderr.WriteString("stagingapi restaurant: skipped (set STAGING_INCLUDE_RESTAURANT=1 to enable)\n")
	}
	if cfg.IncludeDeep {
		_, _ = os.Stderr.WriteString("stagingapi deep journeys: enabled\n")
	}
	if cfg.IncludeSideEffects {
		_, _ = os.Stderr.WriteString("stagingapi side effects: enabled (email/push)\n")
	}
	if cfg.IncludeLLM {
		_, _ = os.Stderr.WriteString("stagingapi LLM routes: enabled\n")
	}
	if cfg.IncludeAdminWrite {
		_, _ = os.Stderr.WriteString("stagingapi admin writes: enabled\n")
	}

	var blockers []string
	if cfg.AdminAPIKey == "" {
		blockers = append(blockers, "ADMIN_API_KEY empty in env (and server) — admin read/write tests will skip. Set in backend/.env and restart API.")
	}
	if cfg.IncludeRestaurant && cfg.RestaurantKitchenID == "" {
		blockers = append(blockers, "no restaurant kitchen for this user — kitchen-scoped tests will skip. Create one in the partner app or set STAGING_RESTAURANT_KITCHEN_ID.")
	}
	if !cfg.IncludeLLM {
		blockers = append(blockers, "STAGING_INCLUDE_LLM disabled — LLM route tests will skip.")
	}
	if cfg.AdminAPIKey != "" && !cfg.IncludeAdminWrite {
		blockers = append(blockers, "STAGING_INCLUDE_ADMIN_WRITE disabled — mutating admin tests will skip.")
	}
	if !cfg.IncludeDeep {
		blockers = append(blockers, "STAGING_INCLUDE_DEEP disabled — multi-step journey tests will skip.")
	}
	if cfg.IncludeDeep && !cfg.IncludeSideEffects {
		blockers = append(blockers, "STAGING_INCLUDE_SIDE_EFFECTS off — diet email / panel push send will skip.")
	}
	if len(blockers) > 0 {
		_, _ = os.Stderr.WriteString("stagingapi blockers still skipping:\n")
		for _, b := range blockers {
			_, _ = os.Stderr.WriteString("  - " + b + "\n")
		}
	}
}

func skipIfNoAdmin(t *testing.T) {
	t.Helper()
	if cfg.AdminAPIKey == "" {
		t.Skip("ADMIN_API_KEY not set — add to backend/.env and restart the API")
	}
}

func skipUnlessRestaurant(t *testing.T) {
	t.Helper()
	if !cfg.IncludeRestaurant {
		t.Skip("restaurant flows skipped — set STAGING_INCLUDE_RESTAURANT=1 to enable")
	}
}

func skipIfNoRestaurantKitchen(t *testing.T) {
	t.Helper()
	skipUnlessRestaurant(t)
	if cfg.RestaurantKitchenID == "" {
		t.Skip("no restaurant kitchen — create one or set STAGING_RESTAURANT_KITCHEN_ID")
	}
}

func skipUnlessLLM(t *testing.T) {
	t.Helper()
	if !cfg.IncludeLLM {
		t.Skip("set STAGING_INCLUDE_LLM=1 to exercise LLM-backed routes")
	}
}

func skipUnlessAdminWrite(t *testing.T) {
	t.Helper()
	if !cfg.IncludeAdminWrite {
		t.Skip("set STAGING_INCLUDE_ADMIN_WRITE=1 to exercise mutating admin routes")
	}
}

func skipUnlessDeep(t *testing.T) {
	t.Helper()
	if !cfg.IncludeDeep {
		t.Skip("set STAGING_INCLUDE_DEEP=1 to exercise multi-step journey tests")
	}
}

func skipUnlessSideEffects(t *testing.T) {
	t.Helper()
	if !cfg.IncludeSideEffects {
		t.Skip("set STAGING_INCLUDE_SIDE_EFFECTS=1 to allow email/push side effects")
	}
}

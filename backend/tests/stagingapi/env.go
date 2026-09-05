//go:build staging

package stagingapi

import (
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultStagingBase = "http://localhost:8080"
const cloudStagingBase = "https://kitchenai-backend-staging-208103249970.asia-south1.run.app"

type envConfig struct {
	BaseURL             string
	AuthToken           string
	UserID              string
	DatabaseURL         string
	SessionSecret       string
	AdminAPIKey         string
	RestaurantKitchenID string
	IncludeLLM          bool
	IncludeAdminWrite   bool
	IncludeRestaurant   bool
	IncludeDeep         bool
	IncludeSideEffects  bool
	HTTPTimeout         time.Duration
}

func loadEnv() envConfig {
	base := strings.TrimRight(firstNonEmpty(os.Getenv("STAGING_BASE_URL"), os.Getenv("API_BASE"), defaultStagingBase), "/")
	// STAGING_BASE_URL=staging selects the Cloud Run staging host.
	if strings.EqualFold(base, "staging") {
		base = cloudStagingBase
	}
	timeoutSec := 90
	if v := strings.TrimSpace(os.Getenv("STAGING_HTTP_TIMEOUT_SEC")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			timeoutSec = n
		}
	}

	local := isLocalBase(base)
	// On localhost, opt into LLM + admin-write + deep journeys unless explicitly disabled.
	includeLLM := truthyDefault(os.Getenv("STAGING_INCLUDE_LLM"), local)
	includeAdminWrite := truthyDefault(os.Getenv("STAGING_INCLUDE_ADMIN_WRITE"), local)
	includeDeep := truthyDefault(os.Getenv("STAGING_INCLUDE_DEEP"), local)
	// Restaurant / partner flows and email/push side effects are opt-in.
	includeRestaurant := truthy(os.Getenv("STAGING_INCLUDE_RESTAURANT"))
	includeSideEffects := truthy(os.Getenv("STAGING_INCLUDE_SIDE_EFFECTS"))

	return envConfig{
		BaseURL:             base,
		AuthToken:           strings.TrimSpace(os.Getenv("STAGING_AUTH_TOKEN")),
		UserID:              strings.TrimSpace(firstNonEmpty(os.Getenv("STAGING_USER_ID"), os.Getenv("USER_ID"))),
		DatabaseURL:         strings.TrimSpace(os.Getenv("DATABASE_URL")),
		SessionSecret:       strings.TrimSpace(os.Getenv("SESSION_TOKEN_SECRET")),
		AdminAPIKey:         strings.TrimSpace(os.Getenv("ADMIN_API_KEY")),
		RestaurantKitchenID: strings.TrimSpace(os.Getenv("STAGING_RESTAURANT_KITCHEN_ID")),
		IncludeLLM:          includeLLM,
		IncludeAdminWrite:   includeAdminWrite,
		IncludeRestaurant:   includeRestaurant,
		IncludeDeep:         includeDeep,
		IncludeSideEffects:  includeSideEffects,
		HTTPTimeout:         time.Duration(timeoutSec) * time.Second,
	}
}

func isLocalBase(base string) bool {
	b := strings.ToLower(base)
	return strings.Contains(b, "localhost") || strings.Contains(b, "127.0.0.1")
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func falsy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "false", "no", "off":
		return true
	default:
		return false
	}
}

// truthyDefault: explicit 0/false wins; otherwise use defaultWhenUnset when env empty.
func truthyDefault(v string, defaultWhenUnset bool) bool {
	if strings.TrimSpace(v) == "" {
		return defaultWhenUnset
	}
	if falsy(v) {
		return false
	}
	return truthy(v) || defaultWhenUnset && !falsy(v)
}

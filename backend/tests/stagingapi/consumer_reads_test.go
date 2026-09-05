//go:build staging

package stagingapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// TestConsumerReadEndpoints hits every session-auth GET (and safe POST that is read-like)
// under /api/v1 that should succeed for a normal staging user with a kitchen.
func TestConsumerReadEndpoints(t *testing.T) {
	type ep struct {
		name   string
		method string
		path   string
		body   any
		ok     []int // allowed success statuses
	}

	endpoints := []ep{
		{"kitchen", http.MethodGet, "/api/v1/kitchen", nil, []int{200, 404}},
		{"ingredients", http.MethodGet, "/api/v1/ingredients?q=tomato&limit=20", nil, []int{200}},
		{"dishes", http.MethodGet, "/api/v1/dishes?q=dal+tadka&limit=10", nil, []int{200}},
		{"dishes/lookup", http.MethodGet, "/api/v1/dishes/lookup?name=Dal%20Tadka", nil, []int{200, 404}},
		{"dishes/recipes", http.MethodGet, "/api/v1/dishes/recipes?q=dal", nil, []int{200}},
		{"inventory/food-groups", http.MethodGet, "/api/v1/inventory/food-groups", nil, []int{200}},
		{"inventory", http.MethodGet, "/api/v1/inventory", nil, []int{200, 404}},
		{"inventory/expiring", http.MethodGet, "/api/v1/inventory/expiring", nil, []int{200, 404}},
		{"inventory/expired", http.MethodGet, "/api/v1/inventory/expired", nil, []int{200, 404}},
		{"user/preferences", http.MethodGet, "/api/v1/user/preferences", nil, []int{200}},
		{"onboarding/status", http.MethodGet, "/api/v1/onboarding/status", nil, []int{200}},
		{"profile", http.MethodGet, "/api/v1/profile", nil, []int{200}},
		{"cook/profile", http.MethodGet, "/api/v1/cook/profile", nil, []int{200}},
		{"cook/messages", http.MethodGet, "/api/v1/cook/messages", nil, []int{200}},
		{"entitlements", http.MethodGet, "/api/v1/entitlements", nil, []int{200}},
		{"notifications/preferences", http.MethodGet, "/api/v1/notifications/preferences", nil, []int{200}},
		{"billing/config", http.MethodGet, "/api/v1/billing/config", nil, []int{200}},
		{"billing/plans", http.MethodGet, "/api/v1/billing/plans", nil, []int{200}},
		{"bill/scan/test", http.MethodGet, "/api/v1/bill/scan/test", nil, []int{200}},
		{"whatsapp/test", http.MethodGet, "/api/v1/whatsapp/test", nil, []int{200}},
		{"whatsapp/cook-info", http.MethodGet, "/api/v1/whatsapp/cook-info", nil, []int{200}},
		{"meals/meal-of-day", http.MethodGet, "/api/v1/meals/meal-of-day", nil, []int{200}},
		{"meals/week-plan", http.MethodGet, "/api/v1/meals/week-plan", nil, []int{200}},
		{"meals/cooked-history", http.MethodGet, "/api/v1/meals/cooked-history", nil, []int{200}},
		{"meals/diet-analysis", http.MethodGet, "/api/v1/meals/diet-analysis", nil, []int{200}},
		{"meals/diet-analysis/report", http.MethodGet, "/api/v1/meals/diet-analysis/report", nil, []int{200, 404}},
		{"rescue-meal/suggestions", http.MethodGet, "/api/v1/rescue-meal/suggestions", nil, []int{200}},
		{"rescue-meal/simple", http.MethodGet, "/api/v1/rescue-meal/simple", nil, []int{200}},
		{"rescue-meal/test", http.MethodGet, "/api/v1/rescue-meal/test", nil, []int{200}},
		{"shopping", http.MethodGet, "/api/v1/shopping", nil, []int{200, 404}},
		{"shopping/order-suggestions", http.MethodGet, "/api/v1/shopping/order-suggestions", nil, []int{200, 404}},
		{"commerce/partners", http.MethodGet, "/api/v1/commerce/partners", nil, []int{200}},
		{"procurement/shopping-list", http.MethodGet, "/api/v1/procurement/shopping-list", nil, []int{200, 404}},
		{"procurement/low-stock", http.MethodGet, "/api/v1/procurement/low-stock", nil, []int{200, 404}},
		{"procurement/summary", http.MethodGet, "/api/v1/procurement/summary", nil, []int{200, 404}},
		{"procurement/recent-lists", http.MethodGet, "/api/v1/procurement/recent-lists", nil, []int{200, 404}},
	}

	for _, ep := range endpoints {
		ep := ep
		t.Run(ep.name, func(t *testing.T) {
			res := client.do(t, ep.method, ep.path, ep.body, nil)
			expectStatus(t, ep.method+" "+ep.path, res.Status, ep.ok...)
		})
	}
}

func TestConsumerLLMReadEndpoints(t *testing.T) {
	skipUnlessLLM(t)

	dishID := lookupDishID(t, dishDalTadka)
	monday := nextWeekdayISO(time.Monday)

	cases := []struct {
		name   string
		method string
		path   string
		body   any
		ok     []int
	}{
		{"meals/smart", http.MethodGet, "/api/v1/meals/smart", nil, []int{200, 404, 503}},
		{"meals/week-plan/refresh", http.MethodPost, "/api/v1/meals/week-plan/refresh", map[string]any{
			"date":      monday,
			"meal_slot": "lunch",
		}, []int{200, 202, 400, 404, 503}},
		{"whatsapp/parse", http.MethodPost, "/api/v1/whatsapp/parse", map[string]any{
			"text": "bought 1 kg tomato and 500 g toor dal from the market",
		}, []int{200, 422, 503}},
		{"meals/week-plan/set-dish", http.MethodPost, "/api/v1/meals/week-plan/set-dish", map[string]any{
			"date":      monday,
			"meal_slot": "lunch",
			"dish_id":   dishID,
		}, []int{200, 400, 404, 503}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			res := client.do(t, tc.method, tc.path, tc.body, nil)
			expectStatus(t, tc.method+" "+tc.path, res.Status, tc.ok...)
		})
	}
}

func lookupDishID(t *testing.T, preferred string) string {
	t.Helper()
	q := url.QueryEscape(preferred)
	res := client.do(t, http.MethodGet, "/api/v1/dishes?q="+q+"&limit=5", nil, nil)
	if res.Status != http.StatusOK {
		return preferred
	}
	var rows []map[string]any
	if err := json.Unmarshal(res.Body, &rows); err != nil {
		return preferred
	}
	for _, row := range rows {
		if id, ok := row["id"].(string); ok && id != "" {
			return id
		}
		if id, ok := row["dish_id"].(string); ok && id != "" {
			return id
		}
	}
	return preferred
}

func nextWeekdayISO(weekday time.Weekday) string {
	now := time.Now()
	delta := (int(weekday) - int(now.Weekday()) + 7) % 7
	if delta == 0 {
		delta = 7
	}
	return now.AddDate(0, 0, delta).Format("2006-01-02")
}

//go:build staging

package stagingapi

import (
	"net/http"
	"testing"
)

func TestRestaurantTopLevel(t *testing.T) {
	skipUnlessRestaurant(t)
	list := client.do(t, http.MethodGet, "/api/v1/restaurant/kitchens", nil, nil)
	expectStatusExact(t, "GET /restaurant/kitchens", list.Status, http.StatusOK, list.Body)

	ings := client.do(t, http.MethodGet, "/api/v1/restaurant/ingredients", nil, nil)
	expectStatusExact(t, "GET /restaurant/ingredients", ings.Status, http.StatusOK, ings.Body)
}

func TestRestaurantKitchenScopedReads(t *testing.T) {
	skipIfNoRestaurantKitchen(t)
	kid := cfg.RestaurantKitchenID
	prefix := "/api/v1/restaurant/" + kid

	reads := []struct {
		name string
		path string
	}{
		{"kitchen detail", prefix},
		{"inventory", prefix + "/inventory"},
		{"members", prefix + "/members"},
		{"menu", prefix + "/menu"},
		{"shopping", prefix + "/shopping"},
		{"orders", prefix + "/orders"},
		{"reports/usage", prefix + "/reports/usage"},
		{"billing/plan", prefix + "/billing/plan"},
		{"analytics/benchmarks", prefix + "/analytics/benchmarks"},
		{"zomato/status", prefix + "/integrations/zomato/status"},
	}

	for _, tc := range reads {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			res := client.do(t, http.MethodGet, tc.path, nil, nil)
			expectStatus(t, "GET "+tc.path, res.Status,
				http.StatusOK, http.StatusForbidden, http.StatusNotFound)
		})
	}
}

func TestRestaurantKitchenScopedWrites(t *testing.T) {
	skipIfNoRestaurantKitchen(t)
	kid := cfg.RestaurantKitchenID
	prefix := "/api/v1/restaurant/" + kid

	tomato := groceryTomato
	tomato.Name = resolveCatalogName(t, tomato.Name)
	onion := groceryOnion
	onion.Name = resolveCatalogName(t, onion.Name)
	// Restaurant stock often stored in grams for produce.
	tomato.Qty, tomato.Unit = 2000, "g"
	onion.Qty, onion.Unit = 2000, "g"

	inv := client.do(t, http.MethodPost, prefix+"/inventory", tomato.restaurantInventoryBody(), nil)
	expectStatus(t, "POST restaurant inventory", inv.Status,
		http.StatusOK, http.StatusCreated, http.StatusForbidden, http.StatusNotFound)

	shop := client.do(t, http.MethodPost, prefix+"/shopping", onion.shoppingBody(), nil)
	expectStatus(t, "POST restaurant shopping", shop.Status,
		http.StatusOK, http.StatusCreated, http.StatusForbidden, http.StatusNotFound)
	if itemID := firstString(shop.jsonMap(t), "item_id", "id"); itemID != "" {
		del := client.do(t, http.MethodDelete, prefix+"/shopping/"+itemID, nil, nil)
		expectStatus(t, "DELETE restaurant shopping", del.Status,
			http.StatusOK, http.StatusNoContent, http.StatusForbidden, http.StatusNotFound)
	}

	dish := resolveDishName(t, dishPaneerButterMasala)
	menu := client.do(t, http.MethodPost, prefix+"/menu", map[string]any{
		"name":        dish,
		"price_cents": 32000,
		"category":    "main",
		"is_active":   true,
	}, nil)
	expectStatus(t, "POST restaurant menu", menu.Status,
		http.StatusOK, http.StatusCreated, http.StatusForbidden, http.StatusNotFound)
}

func TestZomatoIngestUnauthorized(t *testing.T) {
	skipIfNoRestaurantKitchen(t)
	path := "/api/v1/restaurant/" + cfg.RestaurantKitchenID + "/integrations/zomato/ingest"
	// No worker secret — must not succeed.
	res := client.do(t, http.MethodPost, path, map[string]any{"orders": []any{}}, nil)
	expectStatus(t, "POST zomato ingest without secret", res.Status,
		http.StatusUnauthorized, http.StatusForbidden, http.StatusBadRequest, http.StatusNotFound)
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

//go:build staging

package stagingapi

import (
	"net/http"
	"testing"
)

func TestInventoryCRUD(t *testing.T) {
	milk := groceryMilk
	milk.Name = resolveCatalogName(t, milk.Name)

	create := client.do(t, http.MethodPost, "/api/v1/inventory", milk.inventoryCreateBody(7), nil)
	if create.Status == http.StatusNotFound {
		t.Skip("user has no kitchen — create/join kitchen before inventory CRUD")
	}
	expectStatusExact(t, "POST /inventory", create.Status, http.StatusCreated, create.Body)

	itemID := create.stringField(t, "item_id")
	if itemID == "" {
		t.Fatal("POST /inventory missing item_id")
	}
	t.Cleanup(func() {
		_ = client.do(t, http.MethodDelete, "/api/v1/inventory/"+itemID, nil, nil)
	})

	get := client.do(t, http.MethodGet, "/api/v1/inventory/"+itemID, nil, nil)
	expectStatusExact(t, "GET /inventory/{id}", get.Status, http.StatusOK, get.Body)

	upd := client.do(t, http.MethodPut, "/api/v1/inventory/"+itemID, milk.inventoryUpdateBody(2), nil)
	expectStatusExact(t, "PUT /inventory/{id}", upd.Status, http.StatusOK, upd.Body)

	exp := client.do(t, http.MethodPatch, "/api/v1/inventory/"+itemID+"/expire", map[string]any{}, nil)
	expectStatus(t, "PATCH /inventory/{id}/expire", exp.Status, http.StatusOK, http.StatusNoContent)

	del := client.do(t, http.MethodDelete, "/api/v1/inventory/"+itemID, nil, nil)
	expectStatusExact(t, "DELETE /inventory/{id}", del.Status, http.StatusOK, del.Body)
}

func TestShoppingCRUD(t *testing.T) {
	tomato := groceryTomato
	tomato.Name = resolveCatalogName(t, tomato.Name)
	onion := groceryOnion
	onion.Name = resolveCatalogName(t, onion.Name)
	potato := groceryPotato
	potato.Name = resolveCatalogName(t, potato.Name)

	create := client.do(t, http.MethodPost, "/api/v1/shopping", tomato.shoppingBody(), nil)
	if create.Status == http.StatusNotFound {
		t.Skip("user has no kitchen — create/join kitchen before shopping CRUD")
	}
	// 201 on insert; 200 if the same name already existed and was returned.
	expectStatus(t, "POST /shopping", create.Status, http.StatusCreated, http.StatusOK)

	id := create.stringField(t, "id")
	if id == "" {
		id = create.stringField(t, "item_id")
	}
	if id == "" {
		t.Fatalf("POST /shopping missing id\nbody: %s", truncate(create.Body, 400))
	}
	t.Cleanup(func() {
		_ = client.do(t, http.MethodDelete, "/api/v1/shopping/"+id, nil, nil)
	})

	updBody := tomato.shoppingBody()
	updBody["qty"] = 2.0
	updBody["bought"] = false
	upd := client.do(t, http.MethodPut, "/api/v1/shopping/"+id, updBody, nil)
	expectStatusExact(t, "PUT /shopping/{id}", upd.Status, http.StatusOK, upd.Body)

	bulk := client.do(t, http.MethodPost, "/api/v1/shopping/bulk", []map[string]any{
		onion.shoppingBody(),
		potato.shoppingBody(),
	}, nil)
	expectStatus(t, "POST /shopping/bulk", bulk.Status, http.StatusOK, http.StatusCreated)

	del := client.do(t, http.MethodDelete, "/api/v1/shopping/"+id, nil, nil)
	expectStatus(t, "DELETE /shopping/{id}", del.Status, http.StatusNoContent, http.StatusOK)
}

func TestPreferencesAndProfileWrites(t *testing.T) {
	brinjal := resolveCatalogName(t, "Brinjal")
	dalTadka := resolveDishName(t, dishDalTadka)
	paneerButter := resolveDishName(t, dishPaneerButterMasala)

	prefsGet := client.do(t, http.MethodGet, "/api/v1/user/preferences", nil, nil)
	expectStatusExact(t, "GET /user/preferences", prefsGet.Status, http.StatusOK, prefsGet.Body)

	prefsPut := client.do(t, http.MethodPut, "/api/v1/user/preferences", map[string]any{
		"dislikes":     []string{brinjal},
		"dietary_tags": []string{"vegetarian"},
		"fav_cuisines": []string{"indian", "north_indian"},
	}, nil)
	expectStatusExact(t, "PUT /user/preferences", prefsPut.Status, http.StatusOK, prefsPut.Body)

	profileGet := client.do(t, http.MethodGet, "/api/v1/profile", nil, nil)
	expectStatusExact(t, "GET /profile", profileGet.Status, http.StatusOK, profileGet.Body)

	cookGet := client.do(t, http.MethodGet, "/api/v1/cook/profile", nil, nil)
	expectStatusExact(t, "GET /cook/profile", cookGet.Status, http.StatusOK, cookGet.Body)

	cookPut := client.do(t, http.MethodPut, "/api/v1/cook/profile", map[string]any{
		"dishes_known":   []string{dalTadka, paneerButter, dishJeeraRice},
		"preferred_lang": "hi",
	}, nil)
	expectStatusExact(t, "PUT /cook/profile", cookPut.Status, http.StatusOK, cookPut.Body)

	mem := client.do(t, http.MethodPost, "/api/v1/profile/memory", map[string]any{
		"content": "Prefer less oil in tadka; family likes mild spice.",
	}, nil)
	expectStatus(t, "POST /profile/memory", mem.Status, http.StatusOK, http.StatusCreated)
	if memID := mem.stringField(t, "id"); memID != "" {
		del := client.do(t, http.MethodDelete, "/api/v1/profile/memory/"+memID, nil, nil)
		expectStatus(t, "DELETE /profile/memory/{id}", del.Status, http.StatusOK, http.StatusNoContent)
	}
}

func TestPushPreferences(t *testing.T) {
	get := client.do(t, http.MethodGet, "/api/v1/notifications/preferences", nil, nil)
	expectStatusExact(t, "GET /notifications/preferences", get.Status, http.StatusOK, get.Body)

	put := client.do(t, http.MethodPut, "/api/v1/notifications/preferences", map[string]any{
		"marketing_enabled": false,
	}, nil)
	expectStatus(t, "PUT /notifications/preferences", put.Status, http.StatusOK, http.StatusNoContent)

	// Invalid Expo token shape should be rejected without 5xx (not a catalog concern).
	reg := client.do(t, http.MethodPost, "/api/v1/notifications/push-token", map[string]any{
		"expo_push_token": "ExponentPushToken[00000000-0000-0000-0000-000000000000]",
		"platform":        "ios",
	}, nil)
	expectStatus(t, "POST /notifications/push-token", reg.Status,
		http.StatusOK, http.StatusCreated, http.StatusBadRequest, http.StatusUnprocessableEntity)

	del := client.do(t, http.MethodDelete, "/api/v1/notifications/push-token", map[string]any{
		"expo_push_token": "ExponentPushToken[00000000-0000-0000-0000-000000000000]",
	}, nil)
	expectStatus(t, "DELETE /notifications/push-token", del.Status,
		http.StatusOK, http.StatusNoContent, http.StatusNotFound, http.StatusBadRequest)
}

func TestBillingQuoteSmoke(t *testing.T) {
	quote := client.do(t, http.MethodPost, "/api/v1/billing/subscribe/quote", map[string]any{
		"plan_tier":     "pro",
		"plan_interval": "monthly",
	}, nil)
	expectStatus(t, "POST /billing/subscribe/quote", quote.Status,
		http.StatusOK, http.StatusBadRequest, http.StatusServiceUnavailable, http.StatusUnprocessableEntity)
}

func TestProcurementPost(t *testing.T) {
	res := client.do(t, http.MethodPost, "/api/v1/procurement/shopping-list", map[string]any{
		"include_low_stock": true,
		"include_expiring":  true,
		"max_items":         10,
	}, nil)
	expectStatus(t, "POST /procurement/shopping-list", res.Status, http.StatusOK, http.StatusNotFound)
}

func TestStarDish(t *testing.T) {
	dish := resolveDishName(t, dishDalTadka)
	res := client.do(t, http.MethodPost, "/api/v1/dishes/star", map[string]any{
		"dish_name": dish,
	}, nil)
	expectStatus(t, "POST /dishes/star", res.Status, http.StatusOK, http.StatusCreated, http.StatusBadRequest, http.StatusNotFound)
}

func TestDietAnalysisSettings(t *testing.T) {
	get := client.do(t, http.MethodGet, "/api/v1/meals/diet-analysis", nil, nil)
	expectStatusExact(t, "GET /meals/diet-analysis", get.Status, http.StatusOK, get.Body)

	put := client.do(t, http.MethodPut, "/api/v1/meals/diet-analysis", map[string]any{
		"email_enabled": false,
	}, nil)
	expectStatus(t, "PUT /meals/diet-analysis", put.Status, http.StatusOK, http.StatusBadRequest, http.StatusForbidden, http.StatusPaymentRequired)
}

func TestLogCookedDish(t *testing.T) {
	dish := resolveDishName(t, dishDalTadka)
	res := client.do(t, http.MethodPost, "/api/v1/meals/cooked", map[string]any{
		"dish_name": dish,
		"meal_slot": "lunch",
		"portions":  2,
		"source":    "manual",
	}, nil)
	expectStatus(t, "POST /meals/cooked", res.Status, http.StatusOK, http.StatusCreated, http.StatusBadRequest)
}

// TestSeedPantryForAIPaths adds a small realistic pantry so meal / rescue / order-suggest
// endpoints have catalog-linked inventory to reason over (cleaned up after).
func TestSeedPantryForAIPaths(t *testing.T) {
	lines := []groceryLine{groceryTomato, groceryOnion, groceryPotato, groceryToorDal, groceryPaneer, groceryGhee}
	var created []string
	t.Cleanup(func() {
		for _, id := range created {
			_ = client.do(t, http.MethodDelete, "/api/v1/inventory/"+id, nil, nil)
		}
	})

	for _, line := range lines {
		line.Name = resolveCatalogName(t, line.Name)
		res := client.do(t, http.MethodPost, "/api/v1/inventory", line.inventoryCreateBody(5), nil)
		if res.Status == http.StatusNotFound {
			t.Skip("user has no kitchen")
		}
		expectStatus(t, "POST /inventory "+line.Name, res.Status, http.StatusCreated, http.StatusOK)
		if id := res.stringField(t, "item_id"); id != "" {
			created = append(created, id)
		}
	}

	// Read AI-adjacent surfaces with pantry present (may still 500 on unrelated bugs).
	for _, path := range []string{
		"/api/v1/rescue-meal/suggestions",
		"/api/v1/rescue-meal/simple",
		"/api/v1/shopping/order-suggestions",
		"/api/v1/meals/meal-of-day",
	} {
		path := path
		t.Run(path, func(t *testing.T) {
			res := client.do(t, http.MethodGet, path, nil, nil)
			expectStatus(t, "GET "+path, res.Status, http.StatusOK, http.StatusNotFound)
		})
	}
}

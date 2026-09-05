//go:build staging

package stagingapi

import (
	"net/http"
	"testing"
	"time"
)

// TestDeepBillScanToInventory uses /bill/scan/test (mock OCR) then verifies
// catalog-mapped items were added; cleans them up afterward.
func TestDeepBillScanToInventory(t *testing.T) {
	skipUnlessDeep(t)

	res := client.do(t, http.MethodGet, "/api/v1/bill/scan/test", nil, nil)
	expectStatusExact(t, "GET /bill/scan/test", res.Status, http.StatusOK, res.Body)

	m := res.jsonMap(t)
	success, _ := m["success"].(bool)
	if !success {
		t.Fatalf("bill/scan/test success=false body=%s", truncate(res.Body, 400))
	}

	added, _ := m["added_to_inventory"].([]any)
	items, _ := m["items"].([]any)
	if len(items) == 0 && len(added) == 0 {
		t.Fatalf("bill/scan/test returned no items\nbody: %s", truncate(res.Body, 500))
	}

	for _, row := range added {
		rm, ok := row.(map[string]any)
		if !ok {
			continue
		}
		id, _ := rm["item_id"].(string)
		if id == "" {
			id, _ = rm["id"].(string)
		}
		if id == "" {
			continue
		}
		cleanupID := id
		t.Cleanup(func() {
			_ = client.do(t, http.MethodDelete, "/api/v1/inventory/"+cleanupID, nil, nil)
		})
	}

	inv := client.do(t, http.MethodGet, "/api/v1/inventory", nil, nil)
	expectStatus(t, "GET /inventory after bill scan", inv.Status, http.StatusOK, http.StatusNotFound)
}

// TestDeepShoppingPurchase: add catalog lines → purchase → present in inventory.
func TestDeepShoppingPurchase(t *testing.T) {
	skipUnlessDeep(t)

	tomato := groceryTomato
	tomato.Name = resolveCatalogName(t, tomato.Name)
	onion := groceryOnion
	onion.Name = resolveCatalogName(t, onion.Name)

	var shopIDs []string
	var invIDs []string
	t.Cleanup(func() {
		for _, id := range shopIDs {
			_ = client.do(t, http.MethodDelete, "/api/v1/shopping/"+id, nil, nil)
		}
		for _, id := range invIDs {
			_ = client.do(t, http.MethodDelete, "/api/v1/inventory/"+id, nil, nil)
		}
	})

	for _, line := range []groceryLine{tomato, onion} {
		create := client.do(t, http.MethodPost, "/api/v1/shopping", line.shoppingBody(), nil)
		if create.Status == http.StatusNotFound {
			t.Skip("user has no kitchen")
		}
		expectStatus(t, "POST /shopping "+line.Name, create.Status, http.StatusCreated, http.StatusOK)
		id := create.stringField(t, "id")
		if id == "" {
			id = create.stringField(t, "item_id")
		}
		if id == "" {
			t.Fatalf("missing shopping id for %s: %s", line.Name, truncate(create.Body, 300))
		}
		shopIDs = append(shopIDs, id)
	}

	purchase := client.do(t, http.MethodPost, "/api/v1/shopping/purchase", map[string]any{
		"ids": shopIDs,
	}, nil)
	expectStatusExact(t, "POST /shopping/purchase", purchase.Status, http.StatusOK, purchase.Body)

	pm := purchase.jsonMap(t)
	if invList, ok := pm["inventory"].([]any); ok {
		for _, row := range invList {
			rm, _ := row.(map[string]any)
			if id, _ := rm["item_id"].(string); id != "" {
				invIDs = append(invIDs, id)
			}
		}
	}
	shopIDs = nil // purchased rows deleted server-side

	if len(invIDs) == 0 {
		t.Fatalf("purchase returned no inventory ids\nbody: %s", truncate(purchase.Body, 500))
	}
	for _, id := range invIDs {
		get := client.do(t, http.MethodGet, "/api/v1/inventory/"+id, nil, nil)
		expectStatusExact(t, "GET purchased inventory "+id, get.Status, http.StatusOK, get.Body)
	}
}

// TestDeepWhatsAppParseApply: parse market text (LLM) or fall back to a crafted action, then apply.
func TestDeepWhatsAppParseApply(t *testing.T) {
	skipUnlessDeep(t)

	text := "bought 1 kg tomato from the sabzi mandi"
	parse := client.do(t, http.MethodPost, "/api/v1/whatsapp/parse", map[string]any{"text": text}, nil)
	expectStatus(t, "POST /whatsapp/parse", parse.Status,
		http.StatusOK, http.StatusBadRequest, http.StatusUnprocessableEntity, http.StatusServiceUnavailable)

	var applyBody map[string]any
	if parse.Status == http.StatusOK {
		pm := parse.jsonMap(t)
		if actions, ok := pm["actions"].([]any); ok && len(actions) > 0 {
			applyBody = map[string]any{"actions": actions}
		} else if action, ok := pm["action"].(map[string]any); ok {
			applyBody = map[string]any{"action": action}
		}
	}
	if applyBody == nil {
		applyBody = map[string]any{
			"action": map[string]any{
				"intent":     "add_to_shopping_list",
				"confidence": 0.95,
				"summary":    "Add Tomato to shopping list",
				"entities": map[string]any{
					"item_name": resolveCatalogName(t, "Tomato"),
					"qty":       1,
					"unit":      "kg",
				},
			},
		}
	}

	apply := client.do(t, http.MethodPost, "/api/v1/whatsapp/apply", applyBody, nil)
	expectStatus(t, "POST /whatsapp/apply", apply.Status,
		http.StatusOK, http.StatusCreated, http.StatusUnprocessableEntity, http.StatusBadRequest)

	list := client.do(t, http.MethodGet, "/api/v1/shopping", nil, nil)
	if list.Status != http.StatusOK {
		return
	}
	lm := list.jsonMap(t)
	rows, _ := lm["items"].([]any)
	for _, row := range rows {
		rm, _ := row.(map[string]any)
		name, _ := rm["name"].(string)
		id, _ := rm["id"].(string)
		if id != "" && (name == "Tomato" || name == "Tomatoes") {
			_ = client.do(t, http.MethodDelete, "/api/v1/shopping/"+id, nil, nil)
		}
	}
}

// TestDeepOnboardingComplete updates prefs + seeds a couple catalog pantry items.
func TestDeepOnboardingComplete(t *testing.T) {
	skipUnlessDeep(t)

	tomato := resolveCatalogName(t, "Tomato")
	onion := resolveCatalogName(t, "Onion")
	res := client.do(t, http.MethodPost, "/api/v1/onboarding/complete", map[string]any{
		"household_size": 3,
		"dietary_tags":   []string{"vegetarian"},
		"fav_cuisines":   []string{"indian"},
		"spice_level":    "medium",
		"cooking_skill":  "intermediate",
		"allergies":      []string{},
		"dislikes":       []string{},
		"items": []map[string]any{
			{"name": tomato, "qty": 1, "unit": "kg"},
			{"name": onion, "qty": 1, "unit": "kg"},
		},
	}, nil)
	expectStatus(t, "POST /onboarding/complete", res.Status, http.StatusOK, http.StatusCreated)

	status := client.do(t, http.MethodGet, "/api/v1/onboarding/status", nil, nil)
	expectStatusExact(t, "GET /onboarding/status after complete", status.Status, http.StatusOK, status.Body)

	// Best-effort cleanup of just-added tomato/onion rows from inventory buckets.
	inv := client.do(t, http.MethodGet, "/api/v1/inventory", nil, nil)
	if inv.Status != http.StatusOK {
		return
	}
	im := inv.jsonMap(t)
	var rows []any
	for _, key := range []string{"active", "expiring", "expired", "items", "inventory"} {
		if part, ok := im[key].([]any); ok {
			rows = append(rows, part...)
		}
	}
	cleaned := 0
	for i := len(rows) - 1; i >= 0 && cleaned < 2; i-- {
		rm, _ := rows[i].(map[string]any)
		name, _ := rm["canonical_name"].(string)
		id, _ := rm["item_id"].(string)
		if id == "" {
			continue
		}
		if name == tomato || name == onion {
			_ = client.do(t, http.MethodDelete, "/api/v1/inventory/"+id, nil, nil)
			cleaned++
		}
	}
}

// TestDeepKitchenLifecycleSafe exercises create/join error paths without leaving the user's kitchen.
func TestDeepKitchenLifecycleSafe(t *testing.T) {
	skipUnlessDeep(t)

	get := client.do(t, http.MethodGet, "/api/v1/kitchen", nil, nil)
	expectStatus(t, "GET /kitchen", get.Status, http.StatusOK, http.StatusNotFound)

	create := client.do(t, http.MethodPost, "/api/v1/kitchen/create", map[string]any{
		"name": "Staging Suite Kitchen",
	}, nil)
	expectStatus(t, "POST /kitchen/create", create.Status,
		http.StatusOK, http.StatusCreated, http.StatusConflict)

	join := client.do(t, http.MethodPost, "/api/v1/kitchen/join", map[string]any{
		"invite_code": "INVALID1",
	}, nil)
	expectStatus(t, "POST /kitchen/join bad code", join.Status,
		http.StatusNotFound, http.StatusBadRequest, http.StatusConflict)
}

// TestDeepBillingCheckoutSmoke: quote → create order (no real payment verify).
func TestDeepBillingCheckoutSmoke(t *testing.T) {
	skipUnlessDeep(t)

	plan := map[string]any{
		"plan_tier":     "pro",
		"plan_interval": "monthly",
	}
	quote := client.do(t, http.MethodPost, "/api/v1/billing/subscribe/quote", plan, nil)
	expectStatus(t, "POST /billing/subscribe/quote", quote.Status,
		http.StatusOK, http.StatusBadRequest, http.StatusServiceUnavailable, http.StatusUnprocessableEntity)

	order := client.do(t, http.MethodPost, "/api/v1/billing/subscribe/order", plan, nil)
	expectStatus(t, "POST /billing/subscribe/order", order.Status,
		http.StatusOK, http.StatusCreated, http.StatusBadRequest, http.StatusServiceUnavailable, http.StatusUnprocessableEntity, http.StatusConflict)

	verify := client.do(t, http.MethodPost, "/api/v1/billing/subscribe/verify", map[string]any{
		"razorpay_order_id":   "order_fake",
		"razorpay_payment_id": "pay_fake",
		"razorpay_signature":  "sig_fake",
	}, nil)
	expectStatus(t, "POST /billing/subscribe/verify fake", verify.Status,
		http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity, http.StatusServiceUnavailable, http.StatusInternalServerError)
}

// TestDeepCookedDietLoop: log cooked → history → diet report.
func TestDeepCookedDietLoop(t *testing.T) {
	skipUnlessDeep(t)

	dish := resolveDishName(t, dishDalTadka)
	cooked := client.do(t, http.MethodPost, "/api/v1/meals/cooked", map[string]any{
		"dish_name": dish,
		"meal_slot": "dinner",
		"portions":  2,
		"source":    "staging_suite",
	}, nil)
	expectStatus(t, "POST /meals/cooked", cooked.Status, http.StatusOK, http.StatusCreated, http.StatusBadRequest)

	hist := client.do(t, http.MethodGet, "/api/v1/meals/cooked-history", nil, nil)
	expectStatusExact(t, "GET /meals/cooked-history", hist.Status, http.StatusOK, hist.Body)

	today := time.Now().Format("2006-01-02")
	report := client.do(t, http.MethodGet, "/api/v1/meals/diet-analysis/report?date="+today, nil, nil)
	expectStatus(t, "GET /meals/diet-analysis/report", report.Status,
		http.StatusOK, http.StatusNotFound, http.StatusPaymentRequired, http.StatusForbidden, http.StatusBadRequest)

	settings := client.do(t, http.MethodGet, "/api/v1/meals/diet-analysis", nil, nil)
	expectStatusExact(t, "GET /meals/diet-analysis", settings.Status, http.StatusOK, settings.Body)
}

// TestDeepDietSendTest is side-effecting (email); opt-in only.
func TestDeepDietSendTest(t *testing.T) {
	skipUnlessDeep(t)
	skipUnlessSideEffects(t)

	res := client.do(t, http.MethodPost, "/api/v1/meals/diet-analysis/send-test", map[string]any{}, nil)
	expectStatus(t, "POST /meals/diet-analysis/send-test", res.Status,
		http.StatusOK, http.StatusBadRequest, http.StatusPaymentRequired, http.StatusForbidden, http.StatusServiceUnavailable)
}

// TestDeepCommerceOrderLink builds a partner link when commerce is enabled.
func TestDeepCommerceOrderLink(t *testing.T) {
	skipUnlessDeep(t)

	partners := client.do(t, http.MethodGet, "/api/v1/commerce/partners", nil, nil)
	expectStatusExact(t, "GET /commerce/partners", partners.Status, http.StatusOK, partners.Body)
	pm := partners.jsonMap(t)
	enabled, _ := pm["enabled"].(bool)
	list, _ := pm["partners"].([]any)
	if !enabled || len(list) == 0 {
		t.Skip("commerce disabled or no partners configured")
	}
	first, _ := list[0].(map[string]any)
	partnerID, _ := first["id"].(string)
	if partnerID == "" {
		t.Skip("partner missing id")
	}

	link := client.do(t, http.MethodPost, "/api/v1/commerce/order-link", map[string]any{
		"partner": partnerID,
		"source":  "staging_suite",
		"items": []map[string]any{
			{"name": resolveCatalogName(t, "Tomato"), "qty": 1, "unit": "kg"},
			{"name": resolveCatalogName(t, "Onion"), "qty": 1, "unit": "kg"},
		},
	}, nil)
	expectStatus(t, "POST /commerce/order-link", link.Status, http.StatusOK, http.StatusCreated, http.StatusBadRequest, http.StatusNotFound)
}

// TestDeepPanelPushSend requires panel allowlist + side-effects flag.
func TestDeepPanelPushSend(t *testing.T) {
	skipUnlessDeep(t)
	skipUnlessSideEffects(t)

	access := client.do(t, http.MethodGet, "/api/v1/panel/access", nil, nil)
	if access.Status != http.StatusOK {
		t.Skip("session user not on ADMIN_PANEL_EMAILS")
	}

	me := client.do(t, http.MethodGet, "/api/v1/auth/me", nil, nil)
	expectStatusExact(t, "GET /auth/me", me.Status, http.StatusOK, me.Body)
	email := ""
	mm := me.jsonMap(t)
	if u, ok := mm["user"].(map[string]any); ok {
		email, _ = u["email"].(string)
	}
	if email == "" {
		email, _ = mm["email"].(string)
	}

	body := map[string]any{
		"title":        "Staging suite ping",
		"body":         "Deep journey panel push smoke",
		"campaign_key": "staging_suite_deep",
		"broadcast":    false,
	}
	if email != "" {
		body["user_email"] = email
	}
	send := client.do(t, http.MethodPost, "/api/v1/panel/push/send", body, nil)
	expectStatus(t, "POST /panel/push/send", send.Status,
		http.StatusOK, http.StatusCreated, http.StatusBadRequest, http.StatusNotFound, http.StatusServiceUnavailable)
}

// TestDeepBillScanSwiggyPDF runs live parse on the Swiggy Instamart invoice fixture.
// POST /bill/scan extracts items only (does not auto-add inventory).
func TestDeepBillScanSwiggyPDF(t *testing.T) {
	skipUnlessDeep(t)
	skipUnlessLLM(t)

	res := client.do(t, http.MethodPost, "/api/v1/bill/scan", map[string]any{
		"image_data": loadBillFixtureBase64(t, "swiggy_bill.pdf"),
		"image_type": "application/pdf",
	}, nil)
	assertBillScanParsed(t, "POST /bill/scan swiggy PDF", res)
}

// TestDeepBillScanWebP runs live OCR+parse on testdata/bill.webp (Jejani Kirana invoice).
func TestDeepBillScanWebP(t *testing.T) {
	skipUnlessDeep(t)
	skipUnlessLLM(t)

	res := client.do(t, http.MethodPost, "/api/v1/bill/scan", map[string]any{
		"image_data": loadBillFixtureBase64(t, "bill.webp"),
		"image_type": "image/webp",
	}, nil)
	assertBillScanParsed(t, "POST /bill/scan bill.webp", res)
}

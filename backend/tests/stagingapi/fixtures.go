//go:build staging

package stagingapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Catalog-aligned grocery lines (canonical names + units from ingredients catalog).
// Prefer these over free-form "test" strings so LinkForWrite / shopping normalize /
// meal AI paths resolve against the real list.
var (
	groceryMilk = groceryLine{Name: "Milk", Qty: 1, Unit: "L", FoodGroup: "dairy"}
	groceryTomato = groceryLine{Name: "Tomato", Qty: 1, Unit: "kg", FoodGroup: "vegetables"}
	groceryOnion = groceryLine{Name: "Onion", Qty: 1, Unit: "kg", FoodGroup: "vegetables"}
	groceryPotato = groceryLine{Name: "Potato", Qty: 1, Unit: "kg", FoodGroup: "vegetables"}
	groceryPaneer = groceryLine{Name: "Paneer", Qty: 200, Unit: "g", FoodGroup: "dairy"}
	groceryToorDal = groceryLine{Name: "Toor Dal", Qty: 500, Unit: "g", FoodGroup: "pulses"}
	groceryGhee = groceryLine{Name: "Ghee", Qty: 500, Unit: "ml", FoodGroup: "dairy"}
)

const (
	dishDalTadka          = "Dal Tadka"
	dishPaneerButterMasala = "Paneer Butter Masala"
	dishJeeraRice         = "Jeera Rice"
)

type groceryLine struct {
	Name      string
	Qty       float64
	Unit      string
	FoodGroup string
}

func (g groceryLine) inventoryCreateBody(expiryDays int) map[string]any {
	body := map[string]any{
		"canonical_name": g.Name,
		"qty":            g.Qty,
		"unit":           g.Unit,
		"is_manual":      true,
	}
	if g.FoodGroup != "" {
		body["food_group"] = g.FoodGroup
	}
	if expiryDays > 0 {
		body["estimated_expiry"] = time.Now().Add(time.Duration(expiryDays) * 24 * time.Hour).Format("2006-01-02")
	}
	return body
}

func (g groceryLine) inventoryUpdateBody(qty float64) map[string]any {
	return map[string]any{
		"canonical_name": g.Name,
		"qty":            qty,
		"unit":           g.Unit,
		"is_manual":      true,
	}
}

func (g groceryLine) shoppingBody() map[string]any {
	return map[string]any{
		"name": g.Name,
		"qty":  g.Qty,
		"unit": g.Unit,
	}
}

func (g groceryLine) restaurantInventoryBody() map[string]any {
	return map[string]any{
		"name": g.Name,
		"qty":  g.Qty,
		"unit": g.Unit,
	}
}

// resolveCatalogName asks GET /ingredients?q=… and returns a live catalog display
// name when available (falls back to preferred).
func resolveCatalogName(t *testing.T, preferred string) string {
	t.Helper()
	q := url.QueryEscape(preferred)
	res := client.do(t, http.MethodGet, "/api/v1/ingredients?q="+q+"&limit=5", nil, nil)
	if res.Status != http.StatusOK {
		return preferred
	}
	var payload any
	if err := json.Unmarshal(res.Body, &payload); err != nil {
		return preferred
	}
	switch v := payload.(type) {
	case []any:
		for _, row := range v {
			if name := ingredientRowName(row); name != "" {
				return name
			}
		}
	case map[string]any:
		if items, ok := v["items"].([]any); ok {
			for _, row := range items {
				if name := ingredientRowName(row); name != "" {
					return name
				}
			}
		}
		if items, ok := v["ingredients"].([]any); ok {
			for _, row := range items {
				if name := ingredientRowName(row); name != "" {
					return name
				}
			}
		}
	}
	return preferred
}

func ingredientRowName(row any) string {
	m, ok := row.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range []string{"canonical_name", "name", "display_name"} {
		if s, ok := m[key].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func resolveDishName(t *testing.T, preferred string) string {
	t.Helper()
	q := url.QueryEscape(preferred)
	res := client.do(t, http.MethodGet, "/api/v1/dishes?q="+q+"&limit=5", nil, nil)
	if res.Status != http.StatusOK {
		return preferred
	}
	var rows []any
	if err := json.Unmarshal(res.Body, &rows); err != nil {
		// Some handlers wrap under {items:[]}
		var wrap map[string]any
		if err2 := json.Unmarshal(res.Body, &wrap); err2 != nil {
			return preferred
		}
		if items, ok := wrap["items"].([]any); ok {
			rows = items
		}
	}
	for _, row := range rows {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range []string{"name", "display_name"} {
			if s, ok := m[key].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return preferred
}

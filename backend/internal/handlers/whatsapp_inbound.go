package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"
	"kitchenai-backend/pkg/httputil"

	"github.com/lib/pq"
)

type parseWhatsAppRequest struct {
	Text string `json:"text"`
}

type parseWhatsAppResponse struct {
	Action  *services.WhatsAppParsedAction `json:"action"`
	RawText string                         `json:"raw_text"`
}

type applyWhatsAppRequest struct {
	Text   string                         `json:"text,omitempty"`
	Action *services.WhatsAppParsedAction `json:"action,omitempty"`
}

type applyWhatsAppResponse struct {
	Success bool     `json:"success"`
	Message string   `json:"message"`
	Intent  string   `json:"intent,omitempty"`
	Details any      `json:"details,omitempty"`
}

// ParseWhatsAppMessage classifies shared WhatsApp text (no side effects).
func ParseWhatsAppMessage(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req parseWhatsAppRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		req.Text = strings.TrimSpace(req.Text)
		if req.Text == "" {
			http.Error(w, "text is required", http.StatusBadRequest)
			return
		}

		action, err := services.ParseWhatsAppMessage(r.Context(), cfg, req.Text)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": httputil.UserFacingMessage(err)})
			return
		}
		if action == nil {
			action = services.UnknownWhatsAppAction("")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(parseWhatsAppResponse{
			Action:  action,
			RawText: req.Text,
		})
	}
}

// ApplyWhatsAppAction executes a parsed intent (shopping, inventory, prefs, cooked log).
func ApplyWhatsAppAction(db *sql.DB, cfg *config.Config, cookedLog *services.CookedLogService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req applyWhatsAppRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}

		action := req.Action
		if action == nil {
			text := strings.TrimSpace(req.Text)
			if text == "" {
				http.Error(w, "action or text is required", http.StatusBadRequest)
				return
			}
			action, parseErr := services.ParseWhatsAppMessage(r.Context(), cfg, text)
			if parseErr != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": httputil.UserFacingMessage(parseErr)})
				return
			}
			if action == nil {
				action = services.UnknownWhatsAppAction("")
			}
		}

		if action.Intent == services.IntentUnknown || action.Confidence < 0.5 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(applyWhatsAppResponse{
				Success: false,
				Message: "Could not understand this message well enough to act on it.",
				Intent:  string(action.Intent),
			})
			return
		}

		msg, details, err := executeWhatsAppAction(r.Context(), db, cookedLog, userID, action)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(applyWhatsAppResponse{
				Success: false,
				Message: httputil.UserFacingMessage(err),
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(applyWhatsAppResponse{
			Success: true,
			Message: msg,
			Intent:  string(action.Intent),
			Details: details,
		})
	}
}

func executeWhatsAppAction(ctx context.Context, db *sql.DB, cookedLog *services.CookedLogService, userID string, action *services.WhatsAppParsedAction) (string, any, error) {
	name := strings.TrimSpace(action.Entities.ItemName)
	if name == "" && action.Intent != services.IntentNoteDislike && action.Intent != services.IntentReportCookedDish {
		return "", nil, fmt.Errorf("missing item name in parsed action")
	}

	switch action.Intent {
	case services.IntentReportCookedDish:
		dish := strings.TrimSpace(action.Entities.DishName)
		if dish == "" {
			dish = name
		}
		if dish == "" {
			dish = strings.TrimSpace(action.Summary)
		}
		if dish == "" {
			return "", nil, fmt.Errorf("missing dish name in parsed action")
		}
		if cookedLog == nil {
			return "", nil, fmt.Errorf("cooked log service unavailable")
		}
		entry, err := cookedLog.Log(ctx, userID, services.LogCookedDishInput{
			DishName: dish,
			MealSlot: strings.TrimSpace(action.Entities.MealSlot),
			Source:   "whatsapp-parsed",
			Notes:    strings.TrimSpace(action.Entities.Note),
		})
		if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Logged \"%s\" as cooked today.", dish), map[string]any{"cooked_log_id": entry.ID}, nil

	case services.IntentAddShopping:
		qty := action.Entities.Qty
		if qty <= 0 {
			qty = 1
		}
		unit := action.Entities.Unit
		if unit == "" {
			unit = "pcs"
		}
		var id, itemName, itemUnit string
		var itemQty float64
		var bought bool
		var createdAt time.Time
		err := db.QueryRow(`
			INSERT INTO shopping_items (user_id, name, qty, unit)
			VALUES ($1, $2, $3, $4)
			RETURNING id, name, qty, unit, bought, created_at
		`, userID, name, qty, unit).Scan(&id, &itemName, &itemQty, &itemUnit, &bought, &createdAt)
		if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Added \"%s\" to your shopping list.", itemName), map[string]any{
			"shopping_item_id": id,
			"name":             itemName,
			"qty":              itemQty,
			"unit":             itemUnit,
		}, nil

	case services.IntentMarkOutOfStock:
		n, itemID, itemName, err := markInventoryOutOfStock(db, userID, name)
		if err != nil {
			return "", nil, err
		}
		if n == 0 {
			return fmt.Sprintf("No inventory item matched \"%s\" — added to shopping list instead.", name), nil, nil
		}
		return fmt.Sprintf("Marked \"%s\" as expired in inventory.", itemName), map[string]any{
			"inventory_item_id": itemID,
			"name":              itemName,
		}, nil

	case services.IntentAddInventory:
		qty := action.Entities.Qty
		if qty <= 0 {
			qty = 1
		}
		unit := action.Entities.Unit
		if unit == "" {
			unit = "pcs"
		}
		var itemID string
		err := db.QueryRow(`
			INSERT INTO inventory (canonical_name, qty, unit, is_manual, user_id)
			VALUES ($1, $2, $3, true, $4)
			RETURNING item_id
		`, name, qty, unit, userID).Scan(&itemID)
		if err != nil {
			return "", nil, err
		}
		RemoveFromShoppingList(db, userID, name)
		return fmt.Sprintf("Added \"%s\" to inventory.", name), map[string]any{
			"inventory_item_id": itemID,
			"name":              name,
		}, nil

	case services.IntentNoteDislike:
		note := strings.TrimSpace(action.Entities.Note)
		if note == "" {
			note = action.Summary
		}
		dislike := name
		if dislike == "" {
			dislike = note
		}
		if dislike == "" {
			return "", nil, fmt.Errorf("nothing to save as dislike")
		}
		if err := appendUserDislike(db, userID, dislike); err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Noted preference: won't suggest dishes with \"%s\".", dislike), map[string]any{
			"dislike": dislike,
		}, nil

	default:
		return "", nil, fmt.Errorf("unsupported intent: %s", action.Intent)
	}
}

func markInventoryOutOfStock(db *sql.DB, userID, itemName string) (rows int64, itemID, matchedName string, err error) {
	pattern := "%" + strings.ToLower(itemName) + "%"
	res, err := db.Exec(`
		UPDATE inventory
		SET estimated_expiry = CURRENT_DATE - INTERVAL '1 day', updated_at = NOW()
		WHERE (user_id = $1 OR user_id IS NULL)
			AND LOWER(canonical_name) LIKE $2
			AND (estimated_expiry IS NULL OR estimated_expiry >= CURRENT_DATE)
	`, userID, pattern)
	if err != nil {
		return 0, "", "", err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		// Fallback: add to shopping
		_, _ = db.Exec(`
			INSERT INTO shopping_items (user_id, name, qty, unit)
			VALUES ($1, $2, 1, 'pcs')
		`, userID, itemName)
		return 0, "", "", nil
	}
	_ = db.QueryRow(`
		SELECT item_id, canonical_name FROM inventory
		WHERE (user_id = $1 OR user_id IS NULL) AND LOWER(canonical_name) LIKE $2
		ORDER BY updated_at DESC LIMIT 1
	`, userID, pattern).Scan(&itemID, &matchedName)
	return n, itemID, matchedName, nil
}

func appendUserDislike(db *sql.DB, userID, dislike string) error {
	dislike = strings.TrimSpace(dislike)
	if dislike == "" {
		return nil
	}
	var existing pq.StringArray
	err := db.QueryRow(`SELECT COALESCE(dislikes, '{}') FROM user_prefs WHERE user_id = $1`, userID).Scan(&existing)
	if err == sql.ErrNoRows {
		_, err = db.Exec(`INSERT INTO user_prefs (user_id, dislikes) VALUES ($1, $2)`, userID, pq.Array([]string{dislike}))
		return err
	}
	if err != nil {
		return err
	}
	for _, d := range existing {
		if strings.EqualFold(strings.TrimSpace(d), dislike) {
			return nil
		}
	}
	list := make([]string, len(existing))
	copy(list, existing)
	updated := append(list, dislike)
	_, err = db.Exec(`UPDATE user_prefs SET dislikes = $1 WHERE user_id = $2`, pq.Array(updated), userID)
	if err != nil {
		log.Printf("appendUserDislike: %v", err)
	}
	return err
}

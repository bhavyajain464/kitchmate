package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"kitchenai-backend/internal/services"
)

type logCookedDishRequest struct {
	DishName string  `json:"dish_name"`
	DishID   string  `json:"dish_id,omitempty"`
	CookedOn string  `json:"cooked_on,omitempty"` // YYYY-MM-DD
	MealSlot string  `json:"meal_slot,omitempty"`
	Portions float64 `json:"portions,omitempty"`
	Source   string  `json:"source,omitempty"`
	Notes    string  `json:"notes,omitempty"`
}

// GetCookedHistory returns dishes cooked in the last 15 days (Redis cache when available).
func GetCookedHistory(svc *services.CookedLogService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		entries, fromCache, err := svc.ListLast15Days(r.Context(), userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"entries":    entries,
			"days":       services.CookedHistoryDays,
			"from_cache": fromCache,
		})
	}
}

// LogCookedDish records a dish as cooked (persisted + cache refresh).
func LogCookedDish(svc *services.CookedLogService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req logCookedDishRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		var cookedOn time.Time
		if strings.TrimSpace(req.CookedOn) != "" {
			parsed, err := time.Parse("2006-01-02", strings.TrimSpace(req.CookedOn))
			if err != nil {
				http.Error(w, "cooked_on must be YYYY-MM-DD", http.StatusBadRequest)
				return
			}
			cookedOn = parsed
		}
		entry, err := svc.Log(r.Context(), userID, services.LogCookedDishInput{
			DishName: req.DishName,
			DishID:   req.DishID,
			CookedOn: cookedOn,
			MealSlot: req.MealSlot,
			Portions: req.Portions,
			Source:   req.Source,
			Notes:    req.Notes,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(entry)
	}
}

// EnsureCookedLogSchema creates cooked_log table if missing (idempotent).
func EnsureCookedLogSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS cooked_log (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
			dish_name TEXT NOT NULL,
			dish_id UUID,
			cooked_on DATE NOT NULL DEFAULT CURRENT_DATE,
			meal_slot VARCHAR(20) DEFAULT '',
			portions DOUBLE PRECISION DEFAULT 1,
			source VARCHAR(32) NOT NULL DEFAULT 'manual',
			notes TEXT DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_cooked_log_user_cooked_on ON cooked_log (user_id, cooked_on DESC);
		CREATE INDEX IF NOT EXISTS idx_cooked_log_user_created ON cooked_log (user_id, created_at DESC);
	`)
	return err
}

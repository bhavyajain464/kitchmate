package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"kitchenai-backend/internal/models"
)

// GetCookProfile returns cook profile
func GetCookProfile(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// For simplicity, we'll assume a single cook for now
		cookID := "default-cook"

		var profile models.CookProfile
		err := db.QueryRow(`
			SELECT cook_id, dishes_known, preferred_lang, phone_number, created_at, updated_at
			FROM cook_profile
			WHERE cook_id = $1
		`, cookID).Scan(
			&profile.CookID,
			&profile.DishesKnown,
			&profile.PreferredLang,
			&profile.PhoneNumber,
			&profile.CreatedAt,
			&profile.UpdatedAt,
		)

		if err == sql.ErrNoRows {
			// Return default profile if not found
			profile = models.CookProfile{
				CookID:        cookID,
				DishesKnown:   []string{},
				PreferredLang: "en",
			}
		} else if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(profile)
	}
}

// UpdateCookProfile updates cook profile
func UpdateCookProfile(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookID := "default-cook"

		var req models.CookProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate preferred language
		if req.PreferredLang == "" {
			req.PreferredLang = "en"
		}

		// Check if cook profile exists
		var exists bool
		err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM cook_profile WHERE cook_id = $1)", cookID).Scan(&exists)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if exists {
			// Update existing profile
			_, err := db.Exec(`
				UPDATE cook_profile
				SET dishes_known = $1, preferred_lang = $2, phone_number = $3
				WHERE cook_id = $4
			`, req.DishesKnown, req.PreferredLang, req.PhoneNumber, cookID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			// Insert new profile
			_, err := db.Exec(`
				INSERT INTO cook_profile (cook_id, dishes_known, preferred_lang, phone_number)
				VALUES ($1, $2, $3, $4)
			`, cookID, req.DishesKnown, req.PreferredLang, req.PhoneNumber)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "Cook profile updated successfully"})
	}
}

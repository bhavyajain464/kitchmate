package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"kitchenai-backend/internal/models"
)

// GetCookProfile returns the cook profile for the authenticated user
func GetCookProfile(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)

		var profile models.CookProfile
		err := db.QueryRow(`
			SELECT cook_id, dishes_known, preferred_lang, phone_number, created_at, updated_at
			FROM cook_profile
			WHERE user_id = $1
		`, userID).Scan(
			&profile.CookID,
			&profile.DishesKnown,
			&profile.PreferredLang,
			&profile.PhoneNumber,
			&profile.CreatedAt,
			&profile.UpdatedAt,
		)

		if err == sql.ErrNoRows {
			// Fall back to legacy profile without user_id
			err = db.QueryRow(`
				SELECT cook_id, dishes_known, preferred_lang, phone_number, created_at, updated_at
				FROM cook_profile
				WHERE user_id IS NULL
				LIMIT 1
			`).Scan(
				&profile.CookID,
				&profile.DishesKnown,
				&profile.PreferredLang,
				&profile.PhoneNumber,
				&profile.CreatedAt,
				&profile.UpdatedAt,
			)
			if err == sql.ErrNoRows {
				profile = models.CookProfile{
					DishesKnown:   []string{},
					PreferredLang: "en",
				}
			} else if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(profile)
	}
}

// UpdateCookProfile updates the cook profile for the authenticated user
func UpdateCookProfile(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)

		var req models.CookProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if req.PreferredLang == "" {
			req.PreferredLang = "en"
		}

		var exists bool
		err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM cook_profile WHERE user_id = $1)", userID).Scan(&exists)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if exists {
			_, err := db.Exec(`
				UPDATE cook_profile
				SET dishes_known = $1, preferred_lang = $2, phone_number = $3
				WHERE user_id = $4
			`, req.DishesKnown, req.PreferredLang, req.PhoneNumber, userID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			_, err := db.Exec(`
				INSERT INTO cook_profile (dishes_known, preferred_lang, phone_number, user_id)
				VALUES ($1, $2, $3, $4)
			`, req.DishesKnown, req.PreferredLang, req.PhoneNumber, userID)
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

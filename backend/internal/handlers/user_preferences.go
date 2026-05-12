package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"kitchenai-backend/internal/models"
)

// GetUserPreferences returns user preferences
func GetUserPreferences(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		if userID == "" {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}

		var prefs models.UserPreferences
		err := db.QueryRow(`
			SELECT user_id, dislikes, dietary_tags, fav_cuisines, created_at, updated_at
			FROM user_prefs
			WHERE user_id = $1
		`, userID).Scan(
			&prefs.UserID,
			&prefs.Dislikes,
			&prefs.DietaryTags,
			&prefs.FavCuisines,
			&prefs.CreatedAt,
			&prefs.UpdatedAt,
		)

		if err == sql.ErrNoRows {
			// Return default preferences if not found
			prefs = models.UserPreferences{
				UserID:      userID,
				Dislikes:    []string{},
				DietaryTags: []string{},
				FavCuisines: []string{},
			}
		} else if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(prefs)
	}
}

// UpdateUserPreferences updates user preferences
func UpdateUserPreferences(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		if userID == "" {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}

		var req models.UserPreferencesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Check if user preferences exist
		var exists bool
		err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM user_prefs WHERE user_id = $1)", userID).Scan(&exists)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if exists {
			// Update existing preferences
			_, err := db.Exec(`
				UPDATE user_prefs
				SET dislikes = $1, dietary_tags = $2, fav_cuisines = $3
				WHERE user_id = $4
			`, req.Dislikes, req.DietaryTags, req.FavCuisines, userID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			// Insert new preferences
			_, err := db.Exec(`
				INSERT INTO user_prefs (user_id, dislikes, dietary_tags, fav_cuisines)
				VALUES ($1, $2, $3, $4)
			`, userID, req.Dislikes, req.DietaryTags, req.FavCuisines)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "Preferences updated successfully"})
	}
}

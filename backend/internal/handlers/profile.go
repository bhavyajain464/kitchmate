package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	"kitchenai-backend/internal/models"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

func ensureProfileTables(db *sql.DB) {
	queries := []string{
		`ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS household_size INTEGER DEFAULT 2`,
		`ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS allergies TEXT[] DEFAULT '{}'`,
		`ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS spice_level TEXT DEFAULT 'medium'`,
		`ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS cooking_skill TEXT DEFAULT 'intermediate'`,
		`CREATE TABLE IF NOT EXISTS user_memory (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL,
			category TEXT NOT NULL DEFAULT 'general',
			content TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT NOW()
		)`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			log.Printf("Profile table migration warning: %v", err)
		}
	}
}

func GetProfile(db *sql.DB) http.HandlerFunc {
	ensureProfileTables(db)
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		if userID == "" {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}

		var user models.User
		err := db.QueryRow(`SELECT user_id, google_id, email, name, COALESCE(picture_url, '') FROM users WHERE user_id = $1`, userID).
			Scan(&user.UserID, &user.GoogleID, &user.Email, &user.Name, &user.PictureURL)
		if err != nil {
			log.Printf("GetProfile user query error: %v", err)
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}

		profile := models.UserProfile{
			User:         user,
			HouseholdSize: 2,
			SpiceLevel:    "medium",
			CookingSkill:  "intermediate",
			Allergies:     []string{},
			Dislikes:      []string{},
			DietaryTags:   []string{},
			FavCuisines:   []string{},
			Memories:      []models.UserMemory{},
		}

		var allergies, dislikes, dietaryTags, favCuisines pq.StringArray
		var householdSize sql.NullInt64
		var spiceLevel, cookingSkill sql.NullString
		err = db.QueryRow(`
			SELECT COALESCE(household_size, 2), COALESCE(allergies, '{}'), COALESCE(dislikes, '{}'),
				COALESCE(dietary_tags, '{}'), COALESCE(fav_cuisines, '{}'),
				COALESCE(spice_level, 'medium'), COALESCE(cooking_skill, 'intermediate')
			FROM user_prefs WHERE user_id = $1
		`, userID).Scan(&householdSize, &allergies, &dislikes, &dietaryTags, &favCuisines, &spiceLevel, &cookingSkill)
		if err == nil {
			if householdSize.Valid {
				profile.HouseholdSize = int(householdSize.Int64)
			}
			profile.Allergies = []string(allergies)
			profile.Dislikes = []string(dislikes)
			profile.DietaryTags = []string(dietaryTags)
			profile.FavCuisines = []string(favCuisines)
			if spiceLevel.Valid {
				profile.SpiceLevel = spiceLevel.String
			}
			if cookingSkill.Valid {
				profile.CookingSkill = cookingSkill.String
			}
		}

		if profile.Allergies == nil {
			profile.Allergies = []string{}
		}
		if profile.Dislikes == nil {
			profile.Dislikes = []string{}
		}
		if profile.DietaryTags == nil {
			profile.DietaryTags = []string{}
		}
		if profile.FavCuisines == nil {
			profile.FavCuisines = []string{}
		}

		rows, err := db.Query(`SELECT id, user_id, category, content, created_at FROM user_memory WHERE user_id = $1 ORDER BY created_at DESC`, userID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var m models.UserMemory
				if err := rows.Scan(&m.ID, &m.UserID, &m.Category, &m.Content, &m.CreatedAt); err == nil {
					profile.Memories = append(profile.Memories, m)
				}
			}
		}
		if profile.Memories == nil {
			profile.Memories = []models.UserMemory{}
		}

		var invCount int
		db.QueryRow(`SELECT COUNT(*) FROM inventory WHERE (user_id = $1 OR user_id IS NULL) AND qty > 0`, userID).Scan(&invCount)
		profile.InventoryCount = invCount

		var expCount int
		db.QueryRow(`SELECT COUNT(*) FROM inventory WHERE (user_id = $1 OR user_id IS NULL) AND qty > 0 AND estimated_expiry IS NOT NULL AND (estimated_expiry - CURRENT_DATE) <= 3`, userID).Scan(&expCount)
		profile.ExpiringCount = expCount

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(profile)
	}
}

func UpdateProfile(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		if userID == "" {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}

		var req models.UpdateProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var exists bool
		db.QueryRow("SELECT EXISTS(SELECT 1 FROM user_prefs WHERE user_id = $1)", userID).Scan(&exists)

		if exists {
			_, err := db.Exec(`
				UPDATE user_prefs
				SET dislikes = $1, dietary_tags = $2, fav_cuisines = $3,
					household_size = $4, allergies = $5, spice_level = $6, cooking_skill = $7,
					updated_at = NOW()
				WHERE user_id = $8
			`, pq.Array(req.Dislikes), pq.Array(req.DietaryTags), pq.Array(req.FavCuisines),
				req.HouseholdSize, pq.Array(req.Allergies), req.SpiceLevel, req.CookingSkill, userID)
			if err != nil {
				log.Printf("UpdateProfile error: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			_, err := db.Exec(`
				INSERT INTO user_prefs (user_id, dislikes, dietary_tags, fav_cuisines, household_size, allergies, spice_level, cooking_skill)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			`, userID, pq.Array(req.Dislikes), pq.Array(req.DietaryTags), pq.Array(req.FavCuisines),
				req.HouseholdSize, pq.Array(req.Allergies), req.SpiceLevel, req.CookingSkill)
			if err != nil {
				log.Printf("UpdateProfile insert error: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Profile updated"})
	}
}

func AddMemory(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		if userID == "" {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}

		var req models.AddMemoryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if req.Content == "" {
			http.Error(w, "Content is required", http.StatusBadRequest)
			return
		}
		if req.Category == "" {
			req.Category = "general"
		}

		id := uuid.New().String()
		var m models.UserMemory
		err := db.QueryRow(`
			INSERT INTO user_memory (id, user_id, category, content)
			VALUES ($1, $2, $3, $4)
			RETURNING id, user_id, category, content, created_at
		`, id, userID, req.Category, req.Content).Scan(&m.ID, &m.UserID, &m.Category, &m.Content, &m.CreatedAt)
		if err != nil {
			log.Printf("AddMemory error: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(m)
	}
}

func DeleteMemory(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		if userID == "" {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}

		memoryID := mux.Vars(r)["id"]
		result, err := db.Exec(`DELETE FROM user_memory WHERE id = $1 AND user_id = $2`, memoryID, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			http.Error(w, "Memory not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Memory deleted"})
	}
}

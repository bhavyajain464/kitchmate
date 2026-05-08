package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"kitchenai-backend/internal/services"
)

// GetRescueMealSuggestions returns meal suggestions based on expiring items and cook skills
func GetRescueMealSuggestions(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Only allow GET and POST methods
		if r.Method != "GET" && r.Method != "POST" {
			http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		// Parse query parameters
		maxSuggestions := 3
		language := "english"

		if r.Method == "GET" {
			query := r.URL.Query()
			if maxStr := query.Get("max_suggestions"); maxStr != "" {
				if val, err := strconv.Atoi(maxStr); err == nil && val > 0 {
					maxSuggestions = val
				}
			}
			if lang := query.Get("language"); lang != "" {
				language = lang
			}
		} else if r.Method == "POST" {
			// Parse JSON body for POST requests
			var req struct {
				MaxSuggestions int    `json:"max_suggestions"`
				Language       string `json:"language"`
			}

			if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
				if req.MaxSuggestions > 0 {
					maxSuggestions = req.MaxSuggestions
				}
				if req.Language != "" {
					language = req.Language
				}
			}
		}

		// Create meal suggestion service
		mealService := services.NewMealSuggestionService(db)

		// Get rescue meal suggestions
		rescueReq := services.RescueMealRequest{
			MaxSuggestions: maxSuggestions,
			Language:       language,
		}

		response, err := mealService.GetRescueMealSuggestions(rescueReq)
		if err != nil {
			http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}

		// Return response
		json.NewEncoder(w).Encode(response)
	}
}

// GetSimpleRescueMeal returns a simple text-based rescue meal suggestion
func GetSimpleRescueMeal(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Only allow GET method
		if r.Method != "GET" {
			http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		// Create meal suggestion service
		mealService := services.NewMealSuggestionService(db)

		// Get simple rescue meal suggestion
		suggestion, err := mealService.GetSimpleRescueMeal()
		if err != nil {
			http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}

		// Return response
		json.NewEncoder(w).Encode(map[string]string{
			"suggestion": suggestion,
			"type":       "simple_rescue_meal",
		})
	}
}

// TestRescueMeal provides a test endpoint with sample data
func TestRescueMeal(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		// Sample test response
		response := map[string]interface{}{
			"status":  "success",
			"message": "Rescue meal endpoint is working",
			"test_data": map[string]interface{}{
				"expiring_items": []map[string]interface{}{
					{
						"item_id":           "test_1",
						"canonical_name":    "tomato",
						"qty":               5.0,
						"unit":              "pieces",
						"estimated_expiry":  "2026-05-09",
						"days_until_expiry": 2,
					},
					{
						"item_id":           "test_2",
						"canonical_name":    "paneer",
						"qty":               200.0,
						"unit":              "grams",
						"estimated_expiry":  "2026-05-08",
						"days_until_expiry": 1,
					},
				},
				"cook_skills": []string{"Paneer Butter Masala", "Dal Tadka", "Jeera Rice"},
				"user_preferences": map[string]interface{}{
					"dislikes":     []string{"brinjal"},
					"dietary_tags": []string{"vegetarian"},
					"fav_cuisines": []string{"North Indian"},
				},
				"suggestions": []map[string]interface{}{
					{
						"meal_id":        "meal_123",
						"meal_name":      "Paneer Butter Masala",
						"description":    "Paneer Butter Masala - A delicious North Indian dish",
						"cooking_time":   30,
						"priority_score": 0.85,
						"reason":         "Uses 2 expiring ingredients",
						"can_cook":       true,
					},
				},
			},
		}

		json.NewEncoder(w).Encode(response)
	}
}

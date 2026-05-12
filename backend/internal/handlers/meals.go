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

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

type MealCategory struct {
	ID          string       `json:"id"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Meals       []SmartMeal  `json:"meals"`
}

type SmartMeal struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Ingredients    []string `json:"ingredients"`
	CookingTime    int      `json:"cooking_time_mins"`
	Difficulty     string   `json:"difficulty"`
	WhyThisMeal    string   `json:"why_this_meal"`
	NutritionNotes string   `json:"nutrition_notes,omitempty"`
}

type SmartMealsResponse struct {
	Categories    []MealCategory `json:"categories"`
	InventoryUsed int            `json:"inventory_items_used"`
	GeneratedAt   string         `json:"generated_at"`
}

func GetSmartMeals(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)

		inventory := fetchUserInventory(db, userID)
		cookProfile := fetchUserCookProfile(db, userID)
		userPrefs := fetchUserPreferences(db, userID)

		if len(inventory) == 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(SmartMealsResponse{
				Categories:    []MealCategory{},
				InventoryUsed: 0,
				GeneratedAt:   time.Now().Format(time.RFC3339),
			})
			return
		}

		prompt := buildMealPrompt(inventory, cookProfile, userPrefs)

		meals, err := callGeminiForMeals(cfg, prompt)
		if err != nil {
			log.Printf("Gemini meal suggestion error: %v", err)
			meals = fallbackMeals(inventory)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(SmartMealsResponse{
			Categories:    meals,
			InventoryUsed: len(inventory),
			GeneratedAt:   time.Now().Format(time.RFC3339),
		})
	}
}

type inventoryRow struct {
	Name   string
	Qty    float64
	Unit   string
	Expiry *time.Time
}

func fetchUserInventory(db *sql.DB, userID string) []inventoryRow {
	rows, err := db.Query(`
		SELECT canonical_name, SUM(qty) as qty, unit, MIN(estimated_expiry) as estimated_expiry
		FROM inventory
		WHERE (user_id = $1 OR user_id IS NULL) AND qty > 0
		GROUP BY canonical_name, unit
		ORDER BY MIN(estimated_expiry) ASC NULLS LAST
	`, userID)
	if err != nil {
		log.Printf("fetchUserInventory error: %v", err)
		return nil
	}
	defer rows.Close()

	var items []inventoryRow
	for rows.Next() {
		var item inventoryRow
		var expiry sql.NullTime
		if err := rows.Scan(&item.Name, &item.Qty, &item.Unit, &expiry); err != nil {
			continue
		}
		if expiry.Valid {
			item.Expiry = &expiry.Time
		}
		items = append(items, item)
	}
	return items
}

func fetchUserCookProfile(db *sql.DB, userID string) *services.CookProfileData {
	var cp services.CookProfileData
	err := db.QueryRow(`
		SELECT dishes_known, preferred_lang
		FROM cook_profile
		WHERE user_id = $1 OR user_id IS NULL
		LIMIT 1
	`, userID).Scan(&cp.DishesKnown, &cp.PreferredLang)
	if err != nil {
		return nil
	}
	return &cp
}

func fetchUserPreferences(db *sql.DB, userID string) *services.UserPrefsData {
	var up services.UserPrefsData
	var householdSize sql.NullInt64
	var spiceLevel, cookingSkill sql.NullString
	err := db.QueryRow(`
		SELECT dislikes, dietary_tags, fav_cuisines,
			COALESCE(allergies, '{}'), COALESCE(household_size, 2),
			COALESCE(spice_level, 'medium'), COALESCE(cooking_skill, 'intermediate')
		FROM user_prefs
		WHERE user_id = $1
	`, userID).Scan(&up.Dislikes, &up.DietaryTags, &up.FavCuisines,
		&up.Allergies, &householdSize, &spiceLevel, &cookingSkill)
	if err != nil {
		return nil
	}
	if householdSize.Valid {
		up.HouseholdSize = int(householdSize.Int64)
	}
	if spiceLevel.Valid {
		up.SpiceLevel = spiceLevel.String
	}
	if cookingSkill.Valid {
		up.CookingSkill = cookingSkill.String
	}

	rows, err := db.Query(`SELECT content FROM user_memory WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var content string
			if rows.Scan(&content) == nil {
				up.Memories = append(up.Memories, content)
			}
		}
	}
	return &up
}

func buildMealPrompt(inventory []inventoryRow, cook *services.CookProfileData, prefs *services.UserPrefsData) string {
	var sb strings.Builder

	sb.WriteString("You are a smart Indian kitchen meal planner. Based on the household's current inventory, suggest meals in 5 categories.\n\n")

	sb.WriteString("## Current Inventory:\n")
	now := time.Now()
	for _, item := range inventory {
		expiryInfo := ""
		if item.Expiry != nil {
			days := int(item.Expiry.Sub(now).Hours() / 24)
			if days < 0 {
				expiryInfo = fmt.Sprintf(" (EXPIRED %d days ago!)", -days)
			} else if days <= 3 {
				expiryInfo = fmt.Sprintf(" (EXPIRING in %d days)", days)
			} else {
				expiryInfo = fmt.Sprintf(" (good for %d days)", days)
			}
		}
		sb.WriteString(fmt.Sprintf("- %s: %.1f %s%s\n", item.Name, item.Qty, item.Unit, expiryInfo))
	}

	if cook != nil && len(cook.DishesKnown) > 0 {
		sb.WriteString(fmt.Sprintf("\n## Cook's Known Dishes:\n%s\n", strings.Join(cook.DishesKnown, ", ")))
	}

	if prefs != nil {
		if prefs.HouseholdSize > 0 {
			sb.WriteString(fmt.Sprintf("\n## Household Size: %d people\n", prefs.HouseholdSize))
		}
		if len(prefs.Allergies) > 0 {
			sb.WriteString(fmt.Sprintf("## ALLERGIES (MUST AVOID): %s\n", strings.Join(prefs.Allergies, ", ")))
		}
		if len(prefs.Dislikes) > 0 {
			sb.WriteString(fmt.Sprintf("## User Dislikes: %s\n", strings.Join(prefs.Dislikes, ", ")))
		}
		if len(prefs.DietaryTags) > 0 {
			sb.WriteString(fmt.Sprintf("## Dietary: %s\n", strings.Join(prefs.DietaryTags, ", ")))
		}
		if len(prefs.FavCuisines) > 0 {
			sb.WriteString(fmt.Sprintf("## Favorite Cuisines: %s\n", strings.Join(prefs.FavCuisines, ", ")))
		}
		if prefs.SpiceLevel != "" {
			sb.WriteString(fmt.Sprintf("## Spice Preference: %s\n", prefs.SpiceLevel))
		}
		if prefs.CookingSkill != "" {
			sb.WriteString(fmt.Sprintf("## Cooking Skill Level: %s\n", prefs.CookingSkill))
		}
		if len(prefs.Memories) > 0 {
			sb.WriteString("\n## User's Notes & Preferences (Memory):\n")
			for _, m := range prefs.Memories {
				sb.WriteString(fmt.Sprintf("- %s\n", m))
			}
		}
	}

	sb.WriteString(`
## Instructions:
Suggest 2 meals per category. Use ONLY ingredients from the inventory above. Focus on Indian/Bangalore household context.

Return ONLY a JSON array with exactly 5 objects, one per category:

[
  {
    "id": "meal_of_day",
    "title": "Meal of the Day",
    "description": "Best balanced meal for today",
    "meals": [
      {
        "name": "...",
        "description": "One line about the dish",
        "ingredients": ["item1", "item2"],
        "cooking_time_mins": 30,
        "difficulty": "easy",
        "why_this_meal": "Why this is the best pick today",
        "nutrition_notes": "Brief nutrition info"
      }
    ]
  },
  {
    "id": "most_healthy",
    "title": "Most Healthy",
    "description": "Nutrient-rich meals from what you have",
    "meals": [...]
  },
  {
    "id": "most_tasty",
    "title": "Most Tasty",
    "description": "Crowd-pleasers and comfort food",
    "meals": [...]
  },
  {
    "id": "long_lasting",
    "title": "Cook Now, Eat Later",
    "description": "Meals that store well for multiple days",
    "meals": [...]
  },
  {
    "id": "rescue_meal",
    "title": "Rescue Meal",
    "description": "Use expiring items before they go to waste",
    "meals": [...]
  }
]

Return ONLY the JSON array, no markdown, no explanation.`)

	return sb.String()
}

func callGeminiForMeals(cfg *config.Config, prompt string) ([]MealCategory, error) {
	if cfg.GeminiAPIKey == "" {
		return nil, fmt.Errorf("Gemini API key not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client, err := genai.NewClient(ctx, option.WithAPIKey(cfg.GeminiAPIKey))
	if err != nil {
		return nil, err
	}
	defer client.Close()

	model := client.GenerativeModel(cfg.GeminiModel)
	model.SetTemperature(0.7)
	model.SetTopP(0.9)

	resp, err := model.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return nil, fmt.Errorf("Gemini API error: %w", err)
	}

	if resp.Candidates == nil || len(resp.Candidates) == 0 {
		return nil, fmt.Errorf("no response from Gemini")
	}

	var text string
	for _, part := range resp.Candidates[0].Content.Parts {
		if t, ok := part.(genai.Text); ok {
			text = string(t)
			break
		}
	}

	return parseMealCategories(text)
}

func parseMealCategories(raw string) ([]MealCategory, error) {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)

	start := strings.Index(cleaned, "[")
	end := strings.LastIndex(cleaned, "]")
	if start != -1 && end > start {
		cleaned = cleaned[start : end+1]
	}

	var categories []MealCategory
	if err := json.Unmarshal([]byte(cleaned), &categories); err != nil {
		return nil, fmt.Errorf("JSON parse error: %w (raw: %.200s)", err, cleaned)
	}
	return categories, nil
}

func fallbackMeals(inventory []inventoryRow) []MealCategory {
	names := make([]string, 0, len(inventory))
	for _, item := range inventory {
		names = append(names, item.Name)
	}
	ingredientList := strings.Join(names, ", ")

	makeMeal := func(name, desc, why string) SmartMeal {
		return SmartMeal{
			Name:        name,
			Description: desc,
			Ingredients: names,
			CookingTime: 30,
			Difficulty:  "easy",
			WhyThisMeal: why,
		}
	}

	return []MealCategory{
		{ID: "meal_of_day", Title: "Meal of the Day", Description: "Best balanced meal for today",
			Meals: []SmartMeal{makeMeal("Mixed Vegetable Curry with Rice", "A wholesome one-pot meal", "Uses multiple items from your inventory: "+ingredientList)}},
		{ID: "most_healthy", Title: "Most Healthy", Description: "Nutrient-rich meals from what you have",
			Meals: []SmartMeal{makeMeal("Dal Tadka with Roti", "Protein-rich lentil dish", "High in protein and fiber")}},
		{ID: "most_tasty", Title: "Most Tasty", Description: "Crowd-pleasers and comfort food",
			Meals: []SmartMeal{makeMeal("Paneer Butter Masala", "Rich and creamy North Indian classic", "A family favorite")}},
		{ID: "long_lasting", Title: "Cook Now, Eat Later", Description: "Meals that store well for multiple days",
			Meals: []SmartMeal{makeMeal("Rajma (Kidney Bean Curry)", "Stores well for 3-4 days in the fridge", "Great for meal prep")}},
		{ID: "rescue_meal", Title: "Rescue Meal", Description: "Use expiring items before they go to waste",
			Meals: []SmartMeal{makeMeal("Quick Stir Fry", "Use up items before they expire", "Prevents food waste")}},
	}
}

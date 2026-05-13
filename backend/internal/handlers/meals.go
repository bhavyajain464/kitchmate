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
	"github.com/lib/pq"
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
	ItemsToOrder   []string `json:"items_to_order,omitempty"`
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

var categoryMeta = map[string]struct {
	Title string
	Desc  string
	Rule  string
}{
	"rescue_meal":  {Title: "Rescue Meal", Desc: "Use expiring items before they go to waste", Rule: "MUST use the expiring/expired items listed above. Use ONLY inventory items. This is urgent. \"items_to_order\" MUST be empty []."},
	"meal_of_day":  {Title: "Meal of the Day", Desc: "Best balanced meal using only what you have", Rule: "Use ONLY items already in inventory. Pick the best balanced option. \"items_to_order\" MUST be empty []."},
	"most_healthy": {Title: "Most Healthy", Desc: "Nutrient-rich meals for a balanced diet", Rule: "GENERAL suggestions. You may suggest dishes that require items NOT in inventory. List any items NOT in inventory in \"items_to_order\"."},
	"most_tasty":   {Title: "Most Tasty", Desc: "Crowd-pleasing delicious meals", Rule: "GENERAL suggestions. You may suggest dishes that require items NOT in inventory. List any items NOT in inventory in \"items_to_order\"."},
	"long_lasting":  {Title: "Cook Now, Eat Later", Desc: "Meals that store well for days", Rule: "GENERAL suggestions for batch cooking. You may suggest dishes that require items NOT in inventory. List any items NOT in inventory in \"items_to_order\"."},
}

func GetSmartMeals(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		userPrompt := r.URL.Query().Get("prompt")
		category := r.URL.Query().Get("category")
		log.Printf("SmartMeals request: userID=%s, category=%q, userPrompt=%q", userID, category, userPrompt)

		inventory := fetchUserInventory(db, userID)
		cookProfile := fetchUserCookProfile(db, userID)
		userPrefs := fetchUserPreferences(db, userID)

		if userPrefs != nil {
			inventory = filterInventoryByDiet(inventory, userPrefs.DietaryTags)
		}

		if len(inventory) == 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(SmartMealsResponse{
				Categories:    []MealCategory{},
				InventoryUsed: 0,
				GeneratedAt:   time.Now().Format(time.RFC3339),
			})
			return
		}

		prompt := buildMealPrompt(inventory, cookProfile, userPrefs, userPrompt, category)
		prompt += mealVarietySuffix()

		meals, err := callLLMForMeals(cfg, prompt)
		if err != nil {
			log.Printf("meal suggestion LLM error: %v", err)
			meals = fallbackMeals(inventory)
			if category != "" {
				filtered := []MealCategory{}
				for _, m := range meals {
					if m.ID == category {
						filtered = append(filtered, m)
					}
				}
				if len(filtered) > 0 {
					meals = filtered
				}
			}
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
		SELECT COALESCE(cook_name, ''), dishes_known, preferred_lang
		FROM cook_profile
		WHERE user_id = $1 OR user_id IS NULL
		ORDER BY CASE WHEN user_id = $1 THEN 0 ELSE 1 END
		LIMIT 1
	`, userID).Scan(&cp.CookName, pq.Array(&cp.DishesKnown), &cp.PreferredLang)
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
	`, userID).Scan(pq.Array(&up.Dislikes), pq.Array(&up.DietaryTags), pq.Array(&up.FavCuisines),
		pq.Array(&up.Allergies), &householdSize, &spiceLevel, &cookingSkill)
	if err != nil {
		log.Printf("fetchUserPreferences error for %s: %v", userID, err)
		return nil
	}
	log.Printf("User prefs loaded: dietary=%v, allergies=%v, dislikes=%v, cuisines=%v", up.DietaryTags, up.Allergies, up.Dislikes, up.FavCuisines)
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

func buildMealPrompt(inventory []inventoryRow, cook *services.CookProfileData, prefs *services.UserPrefsData, userPrompt string, category string) string {
	var sb strings.Builder

	if category != "" {
		meta, ok := categoryMeta[category]
		if !ok {
			meta = categoryMeta["meal_of_day"]
			category = "meal_of_day"
		}
		sb.WriteString(fmt.Sprintf("You are a smart kitchen meal planner. Suggest 3 meals for the \"%s\" category.\nCategory description: %s\n\n", meta.Title, meta.Desc))
	} else {
		sb.WriteString("You are a smart kitchen meal planner. Based on the household's current inventory and preferences, suggest meals in 5 categories.\n\n")
	}

	sb.WriteString("## Current Inventory:\n")
	now := time.Now()
	var expiringItems []string
	for _, item := range inventory {
		expiryInfo := ""
		if item.Expiry != nil {
			days := int(item.Expiry.Sub(now).Hours() / 24)
			if days < 0 {
				expiryInfo = fmt.Sprintf(" (EXPIRED %d days ago!)", -days)
				expiringItems = append(expiringItems, item.Name)
			} else if days <= 3 {
				expiryInfo = fmt.Sprintf(" (EXPIRING in %d days)", days)
				expiringItems = append(expiringItems, item.Name)
			} else {
				expiryInfo = fmt.Sprintf(" (good for %d days)", days)
			}
		}
		sb.WriteString(fmt.Sprintf("- %s: %.1f %s%s\n", item.Name, item.Qty, item.Unit, expiryInfo))
	}

	if len(expiringItems) > 0 {
		sb.WriteString(fmt.Sprintf("\n## EXPIRING/EXPIRED ITEMS (use urgently): %s\n", strings.Join(expiringItems, ", ")))
	}

	if cook != nil && len(cook.DishesKnown) > 0 {
		sb.WriteString(fmt.Sprintf("\n## Cook's Known Dishes:\n%s\n", strings.Join(cook.DishesKnown, ", ")))
	}
	if cook != nil && strings.TrimSpace(cook.CookName) != "" {
		sb.WriteString(fmt.Sprintf("\n## Cook's name (for tone only; do not echo unnecessarily):\n%s\n", strings.TrimSpace(cook.CookName)))
	}

	if prefs != nil {
		var hardConstraints []string

		if len(prefs.DietaryTags) > 0 {
			for _, tag := range prefs.DietaryTags {
				lower := strings.ToLower(tag)
				if strings.Contains(lower, "vegetarian") || strings.Contains(lower, "vegan") {
					hardConstraints = append(hardConstraints, fmt.Sprintf("User is %s. NEVER suggest meat, poultry, fish, seafood, or eggs. Not even as optional ingredients.", tag))
				} else if strings.Contains(lower, "jain") {
					hardConstraints = append(hardConstraints, fmt.Sprintf("User follows %s diet. No meat, eggs, onion, garlic, or root vegetables.", tag))
				} else {
					hardConstraints = append(hardConstraints, fmt.Sprintf("User follows %s diet.", tag))
				}
			}
		}
		if len(prefs.Allergies) > 0 {
			hardConstraints = append(hardConstraints, fmt.Sprintf("ALLERGIES — user is allergic to: %s. These ingredients MUST NOT appear in any meal.", strings.Join(prefs.Allergies, ", ")))
		}

		if len(hardConstraints) > 0 {
			sb.WriteString("\n## HARD DIETARY CONSTRAINTS (MUST FOLLOW — ZERO EXCEPTIONS):\n")
			for _, c := range hardConstraints {
				sb.WriteString(fmt.Sprintf("- %s\n", c))
			}
			sb.WriteString("Violating any of the above constraints is strictly forbidden.\n")
		}

		if prefs.HouseholdSize > 0 {
			sb.WriteString(fmt.Sprintf("\n## Household Size: %d people\n", prefs.HouseholdSize))
		}
		if len(prefs.Dislikes) > 0 {
			sb.WriteString(fmt.Sprintf("## User Dislikes (avoid if possible): %s\n", strings.Join(prefs.Dislikes, ", ")))
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

	if category != "" {
		meta := categoryMeta[category]
		sb.WriteString(fmt.Sprintf("\n## RULE FOR THIS CATEGORY:\n%s\n", meta.Rule))
		sb.WriteString("\n## Instructions:\nSuggest 3 different meals. Make them varied and creative.\n")
	} else {
		sb.WriteString(`
## IMPORTANT RULES FOR EACH CATEGORY:

1. **rescue_meal**: MUST use the expiring/expired items. Use ONLY inventory items. "items_to_order" MUST be empty [].
2. **meal_of_day**: Use ONLY items in inventory. "items_to_order" MUST be empty [].
3. **most_healthy**, **most_tasty**, **long_lasting**: GENERAL suggestions. May need items NOT in inventory. List those in "items_to_order".

## Instructions:
Suggest 2 meals per category.
`)
	}

	if userPrompt != "" {
		sb.WriteString(fmt.Sprintf("\n## MANDATORY CUISINE/PREFERENCE OVERRIDE:\nThe user has requested: \"%s\"\nYou MUST follow this. Every meal must align with this request. If they say \"italian\", ALL meals must be Italian dishes. Do NOT suggest dishes from other cuisines.\n", userPrompt))
	} else {
		sb.WriteString("\nDefault to Indian household context when no specific cuisine is requested.\n")
	}

	if category != "" {
		meta := categoryMeta[category]
		sb.WriteString(fmt.Sprintf("\nReturn ONLY a JSON array with exactly 1 object:\n\n"))
		sb.WriteString(fmt.Sprintf(`[
  {
    "id": "%s",
    "title": "%s",
    "description": "%s",
    "meals": [
      {
        "name": "...",
        "description": "One line about the dish",
        "ingredients": ["item1", "item2"],
        "items_to_order": [],
        "cooking_time_mins": 30,
        "difficulty": "easy",
        "why_this_meal": "reason",
        "nutrition_notes": "Brief nutrition info"
      }
    ]
  }
]`, category, meta.Title, meta.Desc))
	} else {
		sb.WriteString("\nReturn ONLY a JSON array with exactly 5 objects:\n\n")
		sb.WriteString(`[
  {
    "id": "rescue_meal", "title": "Rescue Meal", "description": "...", "meals": [...]
  },
  {
    "id": "meal_of_day", "title": "Meal of the Day", "description": "...", "meals": [...]
  },
  {
    "id": "most_healthy", "title": "Most Healthy", "description": "...", "meals": [...]
  },
  {
    "id": "most_tasty", "title": "Most Tasty", "description": "...", "meals": [...]
  },
  {
    "id": "long_lasting", "title": "Cook Now, Eat Later", "description": "...", "meals": [...]
  }
]`)
	}
	sb.WriteString("\n\nReturn ONLY the JSON array, no markdown, no explanation.")

	return sb.String()
}

// mealVarietySuffix nudges the model to explore different dishes on each regeneration (same inventory).
func mealVarietySuffix() string {
	n := time.Now().UnixNano()
	return fmt.Sprintf(`

## Variety for this run (request id %d)
This may be a regeneration with identical inventory. You MUST propose meaningfully different meal names and concepts than a "default" answer: rotate regional Indian angles (e.g. coastal, Bengali, Punjabi, South Indian, Northeast, Indo-Chinese home style), cooking modes (one-pot, oven bake, tawa, steamer, no-cook), and protein/carb mixes when diet allows. Do not reuse the same cliché trio every time. Still obey every HARD constraint above.`,
		n)
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
	model.SetTemperature(1.0)
	model.SetTopP(0.98)

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

	if len(text) > 300 {
		log.Printf("Gemini raw response (first 300 chars): %s", text[:300])
	} else {
		log.Printf("Gemini raw response: %s", text)
	}
	return parseMealCategories(text)
}

func callLLMForMeals(cfg *config.Config, prompt string) ([]MealCategory, error) {
	switch cfg.LLMProvider {
	case "gemini":
		return callGeminiForMeals(cfg, prompt)
	default:
		return callGroqForMeals(cfg, prompt)
	}
}

func callGroqForMeals(cfg *config.Config, prompt string) ([]MealCategory, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	text, err := services.GroqChatTextMeals(ctx, cfg.GroqAPIKey, cfg.GroqModel, prompt)
	if err != nil {
		return nil, fmt.Errorf("Groq API error: %w", err)
	}
	if len(text) > 300 {
		log.Printf("Groq raw response (first 300 chars): %s", text[:300])
	} else {
		log.Printf("Groq raw response: %s", text)
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

var nonVegKeywords = []string{
	"chicken", "mutton", "lamb", "fish", "prawn", "shrimp", "crab", "lobster",
	"pork", "beef", "bacon", "ham", "sausage", "salami", "turkey", "duck",
	"meat", "keema", "egg", "eggs", "seafood", "tuna", "salmon", "sardine",
	"anchovy", "squid", "octopus", "venison", "goat",
}

func filterInventoryByDiet(inventory []inventoryRow, dietaryTags []string) []inventoryRow {
	isVeg := false
	for _, tag := range dietaryTags {
		lower := strings.ToLower(tag)
		if strings.Contains(lower, "vegetarian") || strings.Contains(lower, "vegan") || strings.Contains(lower, "jain") {
			isVeg = true
			break
		}
	}
	if !isVeg {
		return inventory
	}

	filtered := make([]inventoryRow, 0, len(inventory))
	for _, item := range inventory {
		nameLower := strings.ToLower(item.Name)
		skip := false
		for _, kw := range nonVegKeywords {
			if strings.Contains(nameLower, kw) {
				log.Printf("Filtered out non-veg item %q for vegetarian user", item.Name)
				skip = true
				break
			}
		}
		if !skip {
			filtered = append(filtered, item)
		}
	}
	return filtered
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

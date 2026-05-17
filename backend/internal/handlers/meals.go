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
	Source        string         `json:"source"` // "ai" or "fallback"
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
	"long_lasting": {Title: "Cook Now, Eat Later", Desc: "Meals that store well for days", Rule: "GENERAL suggestions for batch cooking. You may suggest dishes that require items NOT in inventory. List any items NOT in inventory in \"items_to_order\"."},
	"daily":        {Title: "Daily", Desc: "Simple everyday dish ideas — no special constraints", Rule: "Everyday dish ideas only. Do NOT optimize for expiring inventory, meal prep, or health goals. Suggest familiar, practical home-cooking dishes anyone might make today. Inventory is optional context only — you may ignore it. You may suggest dishes that need items NOT in inventory; list those in \"items_to_order\". Keep suggestions approachable (easy/medium difficulty)."},
}

const (
	maxInventoryInMealPrompt = 35
	maxInventoryInGroqPrompt = 18
	maxRecentDishesInPrompt  = 12
	maxCookDishesInPrompt    = 12
	maxMemoriesInPrompt      = 5
)

func GetSmartMeals(db *sql.DB, cfg *config.Config, cookedLog *services.CookedLogService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		userPrompt := r.URL.Query().Get("prompt")
		category := r.URL.Query().Get("category")
		exclude := parseExcludeDishes(r.URL.Query().Get("exclude"))
		log.Printf("SmartMeals request: userID=%s, category=%q, userPrompt=%q, exclude=%v", userID, category, userPrompt, exclude)

		inventory := fetchUserInventory(db, userID)
		userPrefs := fetchUserPreferences(db, userID)

		if userPrefs != nil {
			inventory = filterInventoryByDiet(inventory, userPrefs.DietaryTags)
		}

		var recentDishes []string
		if cookedLog != nil {
			if entries, _, err := cookedLog.ListLast15Days(r.Context(), userID); err == nil {
				seen := map[string]bool{}
				for _, e := range entries {
					name := strings.TrimSpace(e.DishName)
					key := strings.ToLower(name)
					if name == "" || seen[key] {
						continue
					}
					seen[key] = true
					recentDishes = append(recentDishes, name)
					if len(recentDishes) >= maxRecentDishesInPrompt {
						break
					}
				}
			}
		}

		inventory = trimInventoryForMealPrompt(inventory)

		invNames := make([]string, 0, len(inventory))
		for _, item := range inventory {
			invNames = append(invNames, item.Name)
		}

		retrieveIn := services.DishRetrieveInput{
			Category:       category,
			UserPrompt:     userPrompt,
			RecentDishes:   recentDishes,
			InventoryNames: invNames,
			TopK:           services.CatalogRetrieveTopK,
		}
		if userPrefs != nil {
			retrieveIn.DietaryTags = userPrefs.DietaryTags
			retrieveIn.Allergies = userPrefs.Allergies
			retrieveIn.Dislikes = userPrefs.Dislikes
			retrieveIn.FavCuisines = userPrefs.FavCuisines
			retrieveIn.Memories = userPrefs.Memories
		}
		// Stage 1: word-match catalog (prefs, memories, prompt, inventory) — no Groq.
		candidates := services.RetrieveDishes(retrieveIn)
		log.Printf("[meal_pipeline] stage1 word-match: %d candidates (top %d)", len(candidates), services.CatalogRetrieveTopK)

		if len(inventory) == 0 && category != "daily" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(SmartMealsResponse{
				Categories:    []MealCategory{},
				InventoryUsed: 0,
				GeneratedAt:   time.Now().Format(time.RFC3339),
				Source:        "ai",
			})
			return
		}

		source := "ai"
		var meals []MealCategory
		var err error
		if len(candidates) == 0 {
			log.Printf("[meal_pipeline] stage1 returned no candidates; using fallback")
			source = "fallback"
			meals = fallbackMeals(inventory)
		} else {
			// Stage 2: Groq picks one dish from shortlist + JSON details.
			prompt := buildGroqFilterPrompt(inventory, userPrefs, userPrompt, category, recentDishes, candidates, exclude)
			prompt += mealVarietySuffix(candidates, userPrompt, exclude)
			log.Printf("[meal_pipeline] stage2 groq filter from %d candidates", len(candidates))
			meals, err = callLLMFilterMeals(cfg, prompt)
			if err == nil {
				meals = finalizeMealCategories(meals, category, userPrompt, candidates, inventory, exclude)
			}
		}
		if err != nil {
			log.Printf("meal suggestion LLM error (using random from shortlist): %v", err)
			source = "fallback"
			if len(candidates) > 0 {
				meals = fallbackMealsFromCandidates(candidates, category, inventory, userPrompt, exclude)
			} else {
				meals = fallbackMeals(inventory)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(SmartMealsResponse{
			Categories:    meals,
			InventoryUsed: len(inventory),
			GeneratedAt:   time.Now().Format(time.RFC3339),
			Source:        source,
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

	rows, err := db.Query(`SELECT content FROM user_memory WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, userID)
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

// trimInventoryForMealPrompt caps list size (inventory is already sorted by expiry).
func trimInventoryForMealPrompt(items []inventoryRow) []inventoryRow {
	if len(items) <= maxInventoryInMealPrompt {
		return items
	}
	return items[:maxInventoryInMealPrompt]
}

func parseExcludeDishes(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// buildGroqFilterPrompt is stage 2 only: prefs/memories/prompt were already used in word-match retrieval.
func buildGroqFilterPrompt(inventory []inventoryRow, prefs *services.UserPrefsData, userPrompt string, category string, recentDishes []string, candidates []services.RankedDish, exclude []string) string {
	var sb strings.Builder

	if category != "" {
		meta, ok := categoryMeta[category]
		if !ok {
			meta = categoryMeta["meal_of_day"]
			category = "meal_of_day"
		}
		sb.WriteString(fmt.Sprintf("Stage 2 — filter shortlist for \"%s\" (%s). Pick exactly ONE best dish from the list only; do not add new dish names.\n", meta.Title, meta.Desc))
	} else {
		sb.WriteString("Stage 2 — filter shortlist into 6 categories. Use only candidate dish names.\n")
	}

	sb.WriteString(services.FormatCandidateList(candidates))

	appendHardConstraints(&sb, prefs)

	if len(recentDishes) > 0 {
		sb.WriteString("Avoid repeating: " + strings.Join(recentDishes, ", ") + "\n")
	}

	if category == "rescue_meal" || category == "meal_of_day" || category == "" {
		sb.WriteString("Pantry (for ingredients / rescue rules):\n")
		now := time.Now()
		n := 0
		for _, item := range inventory {
			if n >= maxInventoryInGroqPrompt {
				break
			}
			tag := ""
			if item.Expiry != nil {
				days := int(item.Expiry.Sub(now).Hours() / 24)
				if days <= 3 {
					tag = fmt.Sprintf(" exp%d", days)
				}
			}
			sb.WriteString(fmt.Sprintf("- %s %.0f %s%s\n", item.Name, item.Qty, item.Unit, tag))
			n++
		}
	}

	if category != "" {
		meta := categoryMeta[category]
		sb.WriteString("Rule: " + meta.Rule + "\n")
	}

	if userPrompt != "" {
		sb.WriteString("User request (must respect): \"" + userPrompt + "\"\n")
		sb.WriteString("The single meal MUST match the user request (same main ingredient or dish). Do not suggest unrelated dishes.\n")
	}
	if len(exclude) > 0 {
		sb.WriteString("Do NOT pick these dishes (user already saw them): " + strings.Join(exclude, ", ") + "\n")
	}

	if category != "" {
		meta := categoryMeta[category]
		sb.WriteString(fmt.Sprintf(`Return JSON array with 1 object, exactly 1 meal in "meals". "name" must copy a shortlist dish exactly:
[{"id":"%s","title":"%s","description":"%s","meals":[{"name":"","description":"1 line","ingredients":[],"items_to_order":[],"cooking_time_mins":30,"difficulty":"easy","why_this_meal":"short"}]}]`, category, meta.Title, meta.Desc))
	} else {
		sb.WriteString(`Return JSON array, 6 category objects, exactly 1 meal each; names from shortlist only.`)
	}
	sb.WriteString(" JSON only.")
	return sb.String()
}

func appendHardConstraints(sb *strings.Builder, prefs *services.UserPrefsData) {
	if prefs == nil {
		return
	}
	var hard []string
	for _, tag := range prefs.DietaryTags {
		lower := strings.ToLower(tag)
		if strings.Contains(lower, "vegetarian") || strings.Contains(lower, "vegan") {
			hard = append(hard, "No meat/fish/eggs")
		} else if strings.Contains(lower, "jain") {
			hard = append(hard, "Jain: no meat/eggs/onion/garlic/root veg")
		}
	}
	if len(prefs.Allergies) > 0 {
		hard = append(hard, "Allergies: "+strings.Join(prefs.Allergies, ", "))
	}
	if len(hard) > 0 {
		sb.WriteString("MUST: " + strings.Join(hard, "; ") + "\n")
	}
}

func mealVarietySuffix(candidates []services.RankedDish, userPrompt string, exclude []string) string {
	pool := services.MatchingCandidatesForPrompt(candidates, userPrompt, exclude)
	if len(pool) == 0 {
		pool = services.MatchingCandidatesForPrompt(candidates, userPrompt, nil)
	}
	n := len(pool)
	if n == 0 {
		n = len(candidates)
	}
	return fmt.Sprintf("\nVary your pick across the shortlist (%d eligible dishes; run %d).", n, time.Now().UnixNano())
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

func callLLMFilterMeals(cfg *config.Config, prompt string) ([]MealCategory, error) {
	switch cfg.LLMProvider {
	case "gemini":
		return callGeminiForMeals(cfg, prompt)
	default:
		return callGroqFilterMeals(cfg, prompt)
	}
}

func callGroqFilterMeals(cfg *config.Config, prompt string) ([]MealCategory, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	text, err := services.GroqChatFilterMeals(ctx, cfg.GroqAPIKey, cfg.GroqModel, prompt)
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
	cleaned := cleanMealJSONRaw(raw)
	if cleaned == "" {
		return nil, fmt.Errorf("JSON parse error: empty response")
	}

	var categories []MealCategory
	if err := json.Unmarshal([]byte(cleaned), &categories); err == nil && len(categories) > 0 {
		return categories, nil
	}

	if salvaged, ok := salvageMealCategories(cleaned); ok {
		log.Printf("meal suggestion: salvaged %d categor(ies) from truncated/malformed JSON", len(salvaged))
		return salvaged, nil
	}

	return nil, fmt.Errorf("JSON parse error: could not parse meal JSON (raw: %.200s)", cleaned)
}

func cleanMealJSONRaw(raw string) string {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)
	start := strings.Index(cleaned, "[")
	end := strings.LastIndex(cleaned, "]")
	if start != -1 && end > start {
		cleaned = cleaned[start : end+1]
	} else if start != -1 {
		cleaned = cleaned[start:]
	}
	return cleaned
}

// salvageMealCategories repairs truncated Groq JSON (common when max_tokens cuts the reply).
func salvageMealCategories(cleaned string) ([]MealCategory, bool) {
	suffixes := []string{
		"]",
		"}]",
		"}]}",
		"\"}]}",
		"\"}]}]",
		"\"}]}]}",
		"\"}]}]}]",
	}
	for _, suf := range suffixes {
		var categories []MealCategory
		if err := json.Unmarshal([]byte(cleaned+suf), &categories); err == nil && len(categories) > 0 && len(categories[0].Meals) > 0 {
			return categories, true
		}
	}

	// Extract the first top-level category object if the outer array is broken.
	objStart := strings.Index(cleaned, "{")
	if objStart == -1 {
		return nil, false
	}
	fragment := cleaned[objStart:]
	for _, suf := range suffixes {
		var cat MealCategory
		if err := json.Unmarshal([]byte(fragment+suf), &cat); err == nil && cat.ID != "" && len(cat.Meals) > 0 {
			return []MealCategory{cat}, true
		}
	}
	return nil, false
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

const maxMealsPerCategory = 1

// finalizeMealCategories keeps one meal per category; randomizes within the prompt-matched shortlist.
func finalizeMealCategories(categories []MealCategory, category, userPrompt string, candidates []services.RankedDish, inventory []inventoryRow, exclude []string) []MealCategory {
	invNames := inventoryNames(inventory)
	out := make([]MealCategory, 0, len(categories))
	for _, cat := range categories {
		catID := cat.ID
		if catID == "" {
			catID = category
		}
		var meals []SmartMeal
		if pick, ok := services.RandomCandidateForPrompt(candidates, userPrompt, exclude); ok {
			meal := smartMealFromCatalog(pick.Dish, invNames, catID)
			if groq := firstGroqMealMatching(cat.Meals, userPrompt, pick.Dish.Name); groq != nil {
				meal = mergeGroqMeal(meal, *groq)
			}
			meals = []SmartMeal{meal}
		} else if len(cat.Meals) > 0 {
			meals = cat.Meals
			if len(meals) > maxMealsPerCategory {
				meals = meals[:maxMealsPerCategory]
			}
		}
		cat.Meals = meals
		out = append(out, cat)
	}
	return out
}

func firstGroqMealMatching(groqMeals []SmartMeal, userPrompt, dishName string) *SmartMeal {
	tokens := services.UserPromptTokens(userPrompt)
	target := strings.ToLower(strings.TrimSpace(dishName))
	for i := range groqMeals {
		m := &groqMeals[i]
		if strings.EqualFold(strings.TrimSpace(m.Name), dishName) {
			return m
		}
		if len(tokens) > 0 && mealNameMatchesPrompt(m.Name, tokens) && strings.Contains(strings.ToLower(m.Name), target) {
			return m
		}
	}
	return nil
}

func mergeGroqMeal(base, groq SmartMeal) SmartMeal {
	if d := strings.TrimSpace(groq.Description); d != "" {
		base.Description = d
	}
	if len(groq.Ingredients) > 0 {
		base.Ingredients = groq.Ingredients
	}
	if len(groq.ItemsToOrder) > 0 {
		base.ItemsToOrder = groq.ItemsToOrder
	}
	if groq.CookingTime > 0 {
		base.CookingTime = groq.CookingTime
	}
	if d := strings.TrimSpace(groq.Difficulty); d != "" {
		base.Difficulty = d
	}
	if w := strings.TrimSpace(groq.WhyThisMeal); w != "" {
		base.WhyThisMeal = w
	}
	if n := strings.TrimSpace(groq.NutritionNotes); n != "" {
		base.NutritionNotes = n
	}
	return base
}

func filterMealsMatchingPrompt(meals []SmartMeal, tokens []string) []SmartMeal {
	if len(tokens) == 0 {
		return meals
	}
	out := make([]SmartMeal, 0, len(meals))
	for _, m := range meals {
		if mealNameMatchesPrompt(m.Name, tokens) {
			out = append(out, m)
		}
	}
	return out
}

func mealNameMatchesPrompt(name string, tokens []string) bool {
	lower := strings.ToLower(name)
	for _, t := range tokens {
		if strings.Contains(lower, t) {
			return true
		}
	}
	return false
}

// fallbackMealsFromCandidates picks one random dish from the stage-1 shortlist.
func fallbackMealsFromCandidates(candidates []services.RankedDish, category string, inventory []inventoryRow, userPrompt string, exclude []string) []MealCategory {
	if len(candidates) == 0 {
		return fallbackMeals(inventory)
	}
	meta, ok := categoryMeta[category]
	if !ok {
		meta = categoryMeta["meal_of_day"]
		category = "meal_of_day"
	}

	pick, ok := services.RandomCandidateForPrompt(candidates, userPrompt, exclude)
	if !ok {
		pick = candidates[0]
	}

	invNames := inventoryNames(inventory)
	return []MealCategory{{
		ID:          category,
		Title:       meta.Title,
		Description: meta.Desc,
		Meals:       []SmartMeal{smartMealFromCatalog(pick.Dish, invNames, category)},
	}}
}

func inventoryNames(inventory []inventoryRow) []string {
	names := make([]string, 0, len(inventory))
	for _, item := range inventory {
		names = append(names, item.Name)
	}
	return names
}

func smartMealFromCatalog(d services.CatalogDish, invNames []string, category string) SmartMeal {
	ing := catalogIngredientHints(d, invNames, category)
	why := "Picked from your personalized dish shortlist."
	if c := strings.TrimSpace(d.Cuisine); c != "" {
		why = fmt.Sprintf("From your %s shortlist.", strings.ReplaceAll(c, "-", " "))
	}
	return SmartMeal{
		Name:        d.Name,
		Description: "A home-style option from your personalized shortlist.",
		Ingredients: ing,
		CookingTime: 30,
		Difficulty:  "easy",
		WhyThisMeal: why,
	}
}

func catalogIngredientHints(d services.CatalogDish, invNames []string, category string) []string {
	if category == "rescue_meal" || category == "meal_of_day" {
		if len(invNames) > 0 {
			n := 6
			if len(invNames) < n {
				n = len(invNames)
			}
			return invNames[:n]
		}
	}
	if len(d.Keywords) == 0 {
		return nil
	}
	n := 6
	if len(d.Keywords) < n {
		n = len(d.Keywords)
	}
	out := make([]string, n)
	copy(out, d.Keywords[:n])
	return out
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
		{ID: "daily", Title: "Daily", Description: "Simple everyday dish ideas",
			Meals: []SmartMeal{makeMeal("Khichdi with Pickle", "Comforting one-pot rice and lentil meal", "Easy everyday dinner idea")}},
	}
}

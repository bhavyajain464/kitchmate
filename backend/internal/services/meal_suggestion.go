package services

import (
	"database/sql"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"kitchenai-backend/internal/models"

	"github.com/lib/pq"
)

// MealSuggestionService handles meal suggestion logic
type MealSuggestionService struct {
	db *sql.DB
}

// NewMealSuggestionService creates a new meal suggestion service
func NewMealSuggestionService(db *sql.DB) *MealSuggestionService {
	return &MealSuggestionService{db: db}
}

// RescueMealRequest represents the request for rescue meal suggestions
type RescueMealRequest struct {
	MaxSuggestions int    `json:"max_suggestions"`
	Language       string `json:"language"`
}

// RescueMealResponse represents the response with meal suggestions
type RescueMealResponse struct {
	Suggestions     []MealSuggestion        `json:"suggestions"`
	ExpiringItems   []models.ExpiringItem   `json:"expiring_items"`
	CookSkills      []string                `json:"cook_skills"`
	UserPreferences *models.UserPreferences `json:"user_preferences,omitempty"`
}

// MealSuggestion represents a detailed meal suggestion
type MealSuggestion struct {
	MealID        string              `json:"meal_id"`
	MealName      string              `json:"meal_name"`
	Description   string              `json:"description"`
	Ingredients   []models.Ingredient `json:"ingredients"`
	CookingTime   int                 `json:"cooking_time"` // in minutes
	PriorityScore float64             `json:"priority_score"`
	Reason        string              `json:"reason"`
	CanCook       bool                `json:"can_cook"`
	CookName      string              `json:"cook_name,omitempty"`
}

// Indian meal database - in a real app this would be in a database
var indianMeals = []struct {
	Name        string
	Ingredients []string
	CookingTime int
	Cuisine     string
}{
	{"Paneer Butter Masala", []string{"paneer", "tomato", "cream", "butter", "spices"}, 30, "North Indian"},
	{"Dal Tadka", []string{"lentils", "onion", "tomato", "garlic", "spices"}, 25, "North Indian"},
	{"Jeera Rice", []string{"rice", "cumin", "ghee"}, 20, "North Indian"},
	{"Aloo Gobi", []string{"potato", "cauliflower", "onion", "tomato", "spices"}, 25, "North Indian"},
	{"Chana Masala", []string{"chickpeas", "onion", "tomato", "spices"}, 30, "North Indian"},
	{"Vegetable Biryani", []string{"rice", "mixed vegetables", "yogurt", "spices"}, 40, "Hyderabadi"},
	{"Palak Paneer", []string{"paneer", "spinach", "cream", "spices"}, 25, "North Indian"},
	{"Rajma", []string{"kidney beans", "onion", "tomato", "spices"}, 35, "North Indian"},
	{"Mixed Vegetable Curry", []string{"mixed vegetables", "onion", "tomato", "spices"}, 25, "North Indian"},
	{"Roti", []string{"wheat flour", "water", "salt"}, 15, "North Indian"},
	{"Dosa", []string{"rice", "lentils", "salt"}, 30, "South Indian"},
	{"Sambar", []string{"lentils", "vegetables", "tamarind", "spices"}, 35, "South Indian"},
	{"Rasam", []string{"tomato", "tamarind", "pepper", "spices"}, 20, "South Indian"},
	{"Idli", []string{"rice", "lentils", "salt"}, 30, "South Indian"},
	{"Upma", []string{"semolina", "vegetables", "spices"}, 20, "South Indian"},
}

// GetRescueMealSuggestions generates meal suggestions based on expiring items and cook skills
func (s *MealSuggestionService) GetRescueMealSuggestions(req RescueMealRequest) (*RescueMealResponse, error) {
	// Get expiring items (within 7 days, including recently expired)
	expiringItems, err := s.getExpiringItems(7)
	if err != nil {
		return nil, fmt.Errorf("failed to get expiring items: %v", err)
	}

	// Get cook profile
	cookProfile, err := s.getCookProfile()
	if err != nil {
		log.Printf("Warning: failed to get cook profile: %v", err)
	}

	// Get user preferences
	userPrefs, err := s.getUserPreferences()
	if err != nil {
		log.Printf("Warning: failed to get user preferences: %v", err)
	}

	// Generate meal suggestions
	suggestions := s.generateMealSuggestions(expiringItems, cookProfile, userPrefs, req.MaxSuggestions)

	// Prepare response
	response := &RescueMealResponse{
		Suggestions:     suggestions,
		ExpiringItems:   expiringItems,
		CookSkills:      []string{},
		UserPreferences: userPrefs,
	}

	if cookProfile != nil {
		response.CookSkills = cookProfile.DishesKnown
	}

	return response, nil
}

// getExpiringItems retrieves items expiring within the specified days
func (s *MealSuggestionService) getExpiringItems(days int) ([]models.ExpiringItem, error) {
	query := `
		SELECT 
			item_id,
			canonical_name,
			qty,
			unit,
			estimated_expiry,
			EXTRACT(DAY FROM estimated_expiry - CURRENT_DATE)::integer as days_until_expiry
		FROM inventory 
		WHERE estimated_expiry IS NOT NULL 
			AND estimated_expiry >= CURRENT_DATE - INTERVAL '2 days'
			AND estimated_expiry <= CURRENT_DATE + $1 * INTERVAL '1 day'
		ORDER BY estimated_expiry ASC
	`

	rows, err := s.db.Query(query, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.ExpiringItem
	for rows.Next() {
		var item models.ExpiringItem
		err := rows.Scan(
			&item.ItemID,
			&item.CanonicalName,
			&item.Qty,
			&item.Unit,
			&item.EstimatedExpiry,
			&item.DaysUntilExpiry,
		)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

// getCookProfile retrieves the cook profile
func (s *MealSuggestionService) getCookProfile() (*models.CookProfile, error) {
	query := `SELECT cook_id, COALESCE(cook_name, ''), dishes_known, preferred_lang, COALESCE(phone_number, '') FROM cook_profile LIMIT 1`

	var profile models.CookProfile
	err := s.db.QueryRow(query).Scan(
		&profile.CookID,
		&profile.CookName,
		pq.Array(&profile.DishesKnown),
		&profile.PreferredLang,
		&profile.PhoneNumber,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	return &profile, nil
}

// getUserPreferences retrieves user preferences
func (s *MealSuggestionService) getUserPreferences() (*models.UserPreferences, error) {
	query := `SELECT user_id, dislikes, dietary_tags, fav_cuisines FROM user_prefs LIMIT 1`

	var prefs models.UserPreferences
	err := s.db.QueryRow(query).Scan(
		&prefs.UserID,
		&prefs.Dislikes,
		&prefs.DietaryTags,
		&prefs.FavCuisines,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	return &prefs, nil
}

// generateMealSuggestions creates meal suggestions based on available data
func (s *MealSuggestionService) generateMealSuggestions(
	expiringItems []models.ExpiringItem,
	cookProfile *models.CookProfile,
	userPrefs *models.UserPreferences,
	maxSuggestions int,
) []MealSuggestion {
	if len(expiringItems) == 0 {
		return []MealSuggestion{}
	}

	// Extract expiring ingredient names (lowercase for matching)
	expiringIngredientNames := make(map[string]bool)
	for _, item := range expiringItems {
		expiringIngredientNames[strings.ToLower(item.CanonicalName)] = true
	}

	// Get cook's known dishes
	cookKnownDishes := make(map[string]bool)
	if cookProfile != nil {
		for _, dish := range cookProfile.DishesKnown {
			cookKnownDishes[strings.ToLower(dish)] = true
		}
	}

	// Get user preferences
	userDislikes := make(map[string]bool)
	userFavCuisines := make(map[string]bool)
	if userPrefs != nil {
		for _, dislike := range userPrefs.Dislikes {
			userDislikes[strings.ToLower(dislike)] = true
		}
		for _, cuisine := range userPrefs.FavCuisines {
			userFavCuisines[strings.ToLower(cuisine)] = true
		}
	}

	// Score and filter meals
	var scoredMeals []struct {
		meal        MealSuggestion
		score       float64
		matches     int
		totalNeeded int
	}

	for _, mealDef := range indianMeals {
		// Skip if user dislikes any ingredient
		skip := false
		for _, ing := range mealDef.Ingredients {
			if userDislikes[ing] {
				skip = true
				break
			}
		}
		if skip {
			continue
		}

		// Check how many ingredients match expiring items
		matches := 0
		for _, ing := range mealDef.Ingredients {
			if expiringIngredientNames[ing] {
				matches++
			}
		}

		// Skip if no matches
		if matches == 0 {
			continue
		}

		// Calculate priority score
		score := float64(matches) / float64(len(mealDef.Ingredients))

		// Bonus for cook knowing the dish
		if cookKnownDishes[strings.ToLower(mealDef.Name)] {
			score += 0.3
		}

		// Bonus for user's favorite cuisine
		if userFavCuisines[strings.ToLower(mealDef.Cuisine)] {
			score += 0.2
		}

		// Penalty for longer cooking time
		score -= float64(mealDef.CookingTime) * 0.01

		// Create meal suggestion
		ingredients := make([]models.Ingredient, len(mealDef.Ingredients))
		for i, ingName := range mealDef.Ingredients {
			ingredients[i] = models.Ingredient{
				Name:     ingName,
				Quantity: 100, // Default quantity
				Unit:     "grams",
			}
		}

		meal := MealSuggestion{
			MealID:        fmt.Sprintf("meal_%d", time.Now().Unix()),
			MealName:      mealDef.Name,
			Description:   fmt.Sprintf("%s - A delicious %s dish", mealDef.Name, mealDef.Cuisine),
			Ingredients:   ingredients,
			CookingTime:   mealDef.CookingTime,
			PriorityScore: score,
			Reason:        fmt.Sprintf("Uses %d expiring ingredients", matches),
			CanCook:       cookKnownDishes[strings.ToLower(mealDef.Name)],
		}

		scoredMeals = append(scoredMeals, struct {
			meal        MealSuggestion
			score       float64
			matches     int
			totalNeeded int
		}{
			meal:        meal,
			score:       score,
			matches:     matches,
			totalNeeded: len(mealDef.Ingredients),
		})
	}

	// Sort by score (descending)
	sort.Slice(scoredMeals, func(i, j int) bool {
		return scoredMeals[i].score > scoredMeals[j].score
	})

	// Take top suggestions
	resultCount := len(scoredMeals)
	if resultCount > maxSuggestions && maxSuggestions > 0 {
		resultCount = maxSuggestions
	}

	suggestions := make([]MealSuggestion, resultCount)
	for i := 0; i < resultCount; i++ {
		suggestions[i] = scoredMeals[i].meal
	}

	return suggestions
}

// GetSimpleRescueMeal generates a simple rescue meal suggestion
func (s *MealSuggestionService) GetSimpleRescueMeal() (string, error) {
	expiringItems, err := s.getExpiringItems(3)
	if err != nil {
		return "", err
	}

	if len(expiringItems) == 0 {
		return "No items expiring soon. No rescue meal needed.", nil
	}

	itemNames := make([]string, len(expiringItems))
	for i, item := range expiringItems {
		itemNames[i] = fmt.Sprintf("%s (%s %s)", item.CanonicalName, fmt.Sprintf("%.1f", item.Qty), item.Unit)
	}

	cookProfile, _ := s.getCookProfile()

	if cookProfile != nil && len(cookProfile.DishesKnown) > 0 {
		return fmt.Sprintf("Rescue Meal Suggestion:\n\nExpiring items: %s\n\nCook knows: %s\n\nSuggested meal: %s using %s",
			strings.Join(itemNames, ", "),
			strings.Join(cookProfile.DishesKnown, ", "),
			cookProfile.DishesKnown[0],
			expiringItems[0].CanonicalName), nil
	}

	return fmt.Sprintf("Rescue Meal Suggestion:\n\nExpiring items: %s\n\nSuggested meal: Simple stir-fry using %s",
		strings.Join(itemNames, ", "),
		strings.Join(itemNames, ", ")), nil
}

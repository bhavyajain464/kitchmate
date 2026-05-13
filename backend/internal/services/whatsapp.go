package services

import (
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"kitchenai-backend/internal/models"

	"github.com/lib/pq"
)

// WhatsAppService builds WhatsApp "click to chat" links (https://wa.me/…).
// Messages are sent from the household member's own WhatsApp app, not via a provider API.
type WhatsAppService struct {
	db *sql.DB
}

// NewWhatsAppService creates a WhatsApp helper (no third-party messaging API).
func NewWhatsAppService(db *sql.DB) *WhatsAppService {
	log.Println("WhatsApp: using wa.me compose links (user sends from their app)")
	return &WhatsAppService{
		db: db,
	}
}

// BuildWaMeURL returns a https://wa.me/<digits>?text=… URL for opening WhatsApp with a draft message.
func BuildWaMeURL(rawPhone, message string) (string, error) {
	digits, err := normalizePhoneDigits(rawPhone)
	if err != nil {
		return "", err
	}
	u, err := url.Parse("https://wa.me/" + digits)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("text", message)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func normalizePhoneDigits(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "whatsapp:")
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len(out) < 10 {
		return "", fmt.Errorf("invalid phone number: need at least 10 digits (include country code, e.g. +91…)")
	}
	return out, nil
}

// PrepareGenericWhatsApp returns body text and wa.me URL for an arbitrary recipient.
func (s *WhatsAppService) PrepareGenericWhatsApp(toPhoneNumber, message string) (body, waURL string, err error) {
	if strings.TrimSpace(toPhoneNumber) == "" {
		return "", "", fmt.Errorf("phone number is required")
	}
	if strings.TrimSpace(message) == "" {
		return "", "", fmt.Errorf("message is required")
	}
	waURL, err = BuildWaMeURL(toPhoneNumber, message)
	if err != nil {
		return "", "", err
	}
	return message, waURL, nil
}

// PrepareMealSuggestionToCook builds the message and wa.me URL for the cook from the user's WhatsApp.
func (s *WhatsAppService) PrepareMealSuggestionToCook(userID, mealName string, ingredients []models.Ingredient, cookingTime int, extraNote string) (body, waURL string, err error) {
	cookProfile, err := s.getCookProfileForUser(userID)
	if err != nil {
		return "", "", fmt.Errorf("failed to get cook profile: %w", err)
	}
	if cookProfile.PhoneNumber == "" {
		return "", "", fmt.Errorf("cook phone number not set")
	}
	body = s.buildMealMessage(mealName, ingredients, cookingTime, cookProfile.PreferredLang, cookProfile.CookName)
	if t := strings.TrimSpace(extraNote); t != "" {
		body += "\n\n" + t
	}
	waURL, err = BuildWaMeURL(cookProfile.PhoneNumber, body)
	if err != nil {
		return "", "", err
	}
	return body, waURL, nil
}

// PrepareDailyMenuToCook builds the daily menu message and wa.me URL.
func (s *WhatsAppService) PrepareDailyMenuToCook(userID string, menu []models.MealSuggestion) (body, waURL string, err error) {
	cookProfile, err := s.getCookProfileForUser(userID)
	if err != nil {
		return "", "", fmt.Errorf("failed to get cook profile: %w", err)
	}
	if cookProfile.PhoneNumber == "" {
		return "", "", fmt.Errorf("cook phone number not set")
	}
	body = s.buildDailyMenuMessage(menu, cookProfile.PreferredLang, cookProfile.CookName)
	waURL, err = BuildWaMeURL(cookProfile.PhoneNumber, body)
	if err != nil {
		return "", "", err
	}
	return body, waURL, nil
}

// PrepareShoppingListWhatsApp builds a shopping-list message and wa.me URL for a given number.
func (s *WhatsAppService) PrepareShoppingListWhatsApp(recipientPhone string, items []models.ShoppingListItem) (body, waURL string, err error) {
	body = s.buildShoppingListMessage(items, "en")
	waURL, err = BuildWaMeURL(recipientPhone, body)
	if err != nil {
		return "", "", err
	}
	return body, waURL, nil
}

// getCookProfileForUser loads the cook profile for WhatsApp (scoped to the logged-in user).
func (s *WhatsAppService) getCookProfileForUser(userID string) (*models.CookProfile, error) {
	var profile models.CookProfile
	err := s.db.QueryRow(`
		SELECT cook_id, COALESCE(cook_name, ''), dishes_known, preferred_lang, COALESCE(phone_number, ''), created_at, updated_at
		FROM cook_profile
		WHERE user_id = $1
	`, userID).Scan(
		&profile.CookID,
		&profile.CookName,
		pq.Array(&profile.DishesKnown),
		&profile.PreferredLang,
		&profile.PhoneNumber,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		err = s.db.QueryRow(`
			SELECT cook_id, COALESCE(cook_name, ''), dishes_known, preferred_lang, COALESCE(phone_number, ''), created_at, updated_at
			FROM cook_profile
			WHERE user_id IS NULL
			LIMIT 1
		`).Scan(
			&profile.CookID,
			&profile.CookName,
			pq.Array(&profile.DishesKnown),
			&profile.PreferredLang,
			&profile.PhoneNumber,
			&profile.CreatedAt,
			&profile.UpdatedAt,
		)
	}
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("cook profile not found")
	}
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

// buildMealMessage builds a meal suggestion message in the target language
func (s *WhatsAppService) buildMealMessage(mealName string, ingredients []models.Ingredient, cookingTime int, lang, cookName string) string {
	cookName = strings.TrimSpace(cookName)
	translations := map[string]map[string]string{
		"hi": {
			"meal_suggestion": "भोजन सुझाव",
			"ingredients":     "सामग्री",
			"cooking_time":    "पकाने का समय",
			"minutes":         "मिनट",
			"prepare":         "कृपया तैयार करें",
		},
		"kn": {
			"meal_suggestion": "ಊಟದ ಸಲಹೆ",
			"ingredients":     "ಪದಾರ್ಥಗಳು",
			"cooking_time":    "ಅಡುಗೆ ಸಮಯ",
			"minutes":         "ನಿಮಿಷಗಳು",
			"prepare":         "ದಯವಿಟ್ಟು ತಯಾರಿಸಿ",
		},
	}

	trans := translations[lang]
	if trans == nil {
		trans = map[string]string{
			"meal_suggestion": "Meal Suggestion",
			"ingredients":     "Ingredients",
			"cooking_time":    "Cooking Time",
			"minutes":         "minutes",
			"prepare":         "Please prepare",
		}
	}

	var ingredientsList strings.Builder
	for _, ing := range ingredients {
		ingredientsList.WriteString(fmt.Sprintf("- %s: %.2f %s\n", ing.Name, ing.Quantity, ing.Unit))
	}

	var greeting string
	if cookName != "" {
		switch lang {
		case "hi":
			greeting = fmt.Sprintf("नमस्ते %s,\n\n", cookName)
		case "kn":
			greeting = fmt.Sprintf("ನಮಸ್ಕಾರ %s,\n\n", cookName)
		default:
			greeting = fmt.Sprintf("Hi %s,\n\n", cookName)
		}
	}

	return greeting + fmt.Sprintf(`%s: %s

%s:
%s
%s: %d %s

%s %s`,
		trans["meal_suggestion"], mealName,
		trans["ingredients"], ingredientsList.String(),
		trans["cooking_time"], cookingTime, trans["minutes"],
		trans["prepare"], mealName)
}

// buildDailyMenuMessage builds daily menu message
func (s *WhatsAppService) buildDailyMenuMessage(menu []models.MealSuggestion, lang, cookName string) string {
	cookName = strings.TrimSpace(cookName)
	translations := map[string]map[string]string{
		"hi": {
			"daily_menu": "दैनिक मेनू",
			"meals":      "भोजन",
			"thank_you":  "धन्यवाद",
		},
		"kn": {
			"daily_menu": "ದೈನಂದಿನ ಮೆನು",
			"meals":      "ಊಟಗಳು",
			"thank_you":  "ಧನ್ಯವಾದಗಳು",
		},
	}

	trans := translations[lang]
	if trans == nil {
		trans = map[string]string{
			"daily_menu": "Daily Menu",
			"meals":      "Meals",
			"thank_you":  "Thank you",
		}
	}

	today := time.Now().Format("January 2, 2006")

	var mealsList strings.Builder
	for i, meal := range menu {
		mealsList.WriteString(fmt.Sprintf("%d. %s\n", i+1, meal.MealName))
	}

	var greeting string
	if cookName != "" {
		switch lang {
		case "hi":
			greeting = fmt.Sprintf("नमस्ते %s,\n\n", cookName)
		case "kn":
			greeting = fmt.Sprintf("ನಮಸ್ಕಾರ %s,\n\n", cookName)
		default:
			greeting = fmt.Sprintf("Hi %s,\n\n", cookName)
		}
	}

	return greeting + fmt.Sprintf(`%s - %s

%s:
%s
%s`,
		trans["daily_menu"], today,
		trans["meals"], mealsList.String(),
		trans["thank_you"])
}

// buildShoppingListMessage builds shopping list message
func (s *WhatsAppService) buildShoppingListMessage(items []models.ShoppingListItem, lang string) string {
	var list strings.Builder
	list.WriteString("🛒 Shopping List:\n\n")

	for i, item := range items {
		list.WriteString(fmt.Sprintf("%d. %s - %.2f %s\n", i+1, item.Name, item.Quantity, item.Unit))
	}

	list.WriteString("\nPlease purchase these items.")
	_ = lang
	return list.String()
}

// PrepareTestWhatsApp returns a sample compose link (no cook profile required).
func (s *WhatsAppService) PrepareTestWhatsApp() (body, waURL string, err error) {
	body = "Test message from Kitchen AI — WhatsApp compose link check."
	waURL, err = BuildWaMeURL("+919876543210", body)
	return body, waURL, err
}

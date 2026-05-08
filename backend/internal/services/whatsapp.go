package services

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"kitchenai-backend/internal/models"
	"kitchenai-backend/pkg/config"

	"github.com/twilio/twilio-go"
	twilioApi "github.com/twilio/twilio-go/rest/api/v2010"
)

// WhatsAppService handles WhatsApp messaging via Twilio
type WhatsAppService struct {
	config       *config.Config
	twilioClient *twilio.RestClient
	db           *sql.DB
}

// NewWhatsAppService creates a new WhatsApp service
func NewWhatsAppService(cfg *config.Config, db *sql.DB) *WhatsAppService {
	var client *twilio.RestClient

	if cfg.TwilioAccountSID != "" && cfg.TwilioAuthToken != "" {
		client = twilio.NewRestClientWithParams(twilio.ClientParams{
			Username: cfg.TwilioAccountSID,
			Password: cfg.TwilioAuthToken,
		})
		log.Println("Twilio client initialized")
	} else {
		log.Println("Twilio credentials not provided, running in test mode")
	}

	return &WhatsAppService{
		config:       cfg,
		twilioClient: client,
		db:           db,
	}
}

// SendMessage sends a WhatsApp message to a phone number
func (s *WhatsAppService) SendMessage(toPhoneNumber, message string) (string, error) {
	// Format phone number for WhatsApp
	if !strings.HasPrefix(toPhoneNumber, "whatsapp:") {
		toPhoneNumber = "whatsapp:" + toPhoneNumber
	}

	// If in test mode or no Twilio client, log and return mock response
	if s.config.WhatsAppTestMode || s.twilioClient == nil {
		log.Printf("[TEST MODE] Would send WhatsApp message to %s: %s", toPhoneNumber, message)
		return "mock-message-sid-test", nil
	}

	params := &twilioApi.CreateMessageParams{}
	params.SetTo(toPhoneNumber)
	params.SetFrom(s.config.TwilioWhatsAppFrom)
	params.SetBody(message)

	resp, err := s.twilioClient.Api.CreateMessage(params)
	if err != nil {
		return "", fmt.Errorf("failed to send WhatsApp message: %w", err)
	}

	if resp.Sid != nil {
		return *resp.Sid, nil
	}

	return "", fmt.Errorf("no message SID returned from Twilio")
}

// SendMealSuggestionToCook sends a meal suggestion to the cook in their preferred language
func (s *WhatsAppService) SendMealSuggestionToCook(mealName string, ingredients []models.Ingredient, cookingTime int) (string, error) {
	// Get cook profile
	cookProfile, err := s.getCookProfile()
	if err != nil {
		return "", fmt.Errorf("failed to get cook profile: %w", err)
	}

	// If no phone number, return error
	if cookProfile.PhoneNumber == "" {
		return "", fmt.Errorf("cook phone number not set")
	}

	// Translate message to cook's preferred language
	message := s.buildMealMessage(mealName, ingredients, cookingTime, cookProfile.PreferredLang)

	// Send message
	return s.SendMessage(cookProfile.PhoneNumber, message)
}

// SendDailyMenu sends the approved daily menu to the cook
func (s *WhatsAppService) SendDailyMenu(menu []models.MealSuggestion) (string, error) {
	cookProfile, err := s.getCookProfile()
	if err != nil {
		return "", fmt.Errorf("failed to get cook profile: %w", err)
	}

	if cookProfile.PhoneNumber == "" {
		return "", fmt.Errorf("cook phone number not set")
	}

	message := s.buildDailyMenuMessage(menu, cookProfile.PreferredLang)
	return s.SendMessage(cookProfile.PhoneNumber, message)
}

// SendShoppingList sends shopping list to user/cook
func (s *WhatsAppService) SendShoppingList(items []models.ShoppingListItem, recipientPhone string) (string, error) {
	message := s.buildShoppingListMessage(items, "en") // Default to English for shopping lists
	return s.SendMessage(recipientPhone, message)
}

// getCookProfile retrieves the cook profile from database
func (s *WhatsAppService) getCookProfile() (*models.CookProfile, error) {
	cookID := "default-cook"

	var profile models.CookProfile
	err := s.db.QueryRow(`
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
		// Return default profile
		return &models.CookProfile{
			CookID:        cookID,
			DishesKnown:   []string{},
			PreferredLang: "en",
			PhoneNumber:   "",
		}, nil
	} else if err != nil {
		return nil, err
	}

	return &profile, nil
}

// buildMealMessage builds a meal suggestion message in the target language
func (s *WhatsAppService) buildMealMessage(mealName string, ingredients []models.Ingredient, cookingTime int, lang string) string {
	// Simple translation mapping for demonstration
	// In a real implementation, you would use Google Translate API
	translations := map[string]map[string]string{
		"hi": { // Hindi
			"meal_suggestion": "भोजन सुझाव",
			"ingredients":     "सामग्री",
			"cooking_time":    "पकाने का समय",
			"minutes":         "मिनट",
			"prepare":         "कृपया तैयार करें",
		},
		"kn": { // Kannada
			"meal_suggestion": "ಊಟದ ಸಲಹೆ",
			"ingredients":     "ಪದಾರ್ಥಗಳು",
			"cooking_time":    "ಅಡುಗೆ ಸಮಯ",
			"minutes":         "ನಿಮಿಷಗಳು",
			"prepare":         "ದಯವಿಟ್ಟು ತಯಾರಿಸಿ",
		},
	}

	// Default to English
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

	return fmt.Sprintf(`%s: %s

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
func (s *WhatsAppService) buildDailyMenuMessage(menu []models.MealSuggestion, lang string) string {
	translations := map[string]map[string]string{
		"hi": {
			"daily_menu": "दैनिक मेनू",
			"date":       "तारीख",
			"meals":      "भोजन",
			"thank_you":  "धन्यवाद",
		},
		"kn": {
			"daily_menu": "ದೈನಂದಿನ ಮೆನು",
			"date":       "ದಿನಾಂಕ",
			"meals":      "ಊಟಗಳು",
			"thank_you":  "ಧನ್ಯವಾದಗಳು",
		},
	}

	trans := translations[lang]
	if trans == nil {
		trans = map[string]string{
			"daily_menu": "Daily Menu",
			"date":       "Date",
			"meals":      "Meals",
			"thank_you":  "Thank you",
		}
	}

	today := time.Now().Format("January 2, 2006")

	var mealsList strings.Builder
	for i, meal := range menu {
		mealsList.WriteString(fmt.Sprintf("%d. %s\n", i+1, meal.MealName))
	}

	return fmt.Sprintf(`%s - %s

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
	return list.String()
}

// TestSendMessage sends a test WhatsApp message (for development)
func (s *WhatsAppService) TestSendMessage() (string, error) {
	testPhone := "whatsapp:+919876543210" // Sample Indian number
	testMessage := "Test message from Kitchen AI. This is a test of WhatsApp integration."

	return s.SendMessage(testPhone, testMessage)
}

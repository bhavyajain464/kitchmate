package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"kitchenai-backend/internal/models"
	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"
)

// SendWhatsAppMessageRequest represents the request to send a WhatsApp message
type SendWhatsAppMessageRequest struct {
	PhoneNumber string `json:"phone_number"`
	Message     string `json:"message"`
	TestMode    bool   `json:"test_mode,omitempty"`
}

// SendWhatsAppMessageResponse represents the response from sending a WhatsApp message
type SendWhatsAppMessageResponse struct {
	Success   bool   `json:"success"`
	MessageID string `json:"message_id,omitempty"`
	Error     string `json:"error,omitempty"`
}

// SendMealSuggestionRequest represents the request to send a meal suggestion
type SendMealSuggestionRequest struct {
	MealName    string              `json:"meal_name"`
	Ingredients []models.Ingredient `json:"ingredients"`
	CookingTime int                 `json:"cooking_time"`
	TestMode    bool                `json:"test_mode,omitempty"`
}

// SendDailyMenuRequest represents the request to send a daily menu
type SendDailyMenuRequest struct {
	Menu     []DailyMenuItem `json:"menu"`
	TestMode bool            `json:"test_mode,omitempty"`
}

// DailyMenuItem represents a meal in the daily menu
type DailyMenuItem struct {
	MealName string `json:"meal_name"`
	MealTime string `json:"meal_time,omitempty"` // breakfast, lunch, dinner
}

// SendWhatsAppMessage sends a WhatsApp message
func SendWhatsAppMessage(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req SendWhatsAppMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate phone number
		if req.PhoneNumber == "" {
			http.Error(w, "phone_number is required", http.StatusBadRequest)
			return
		}

		// Initialize WhatsApp service
		whatsappService := services.NewWhatsAppService(cfg, db)

		// Send message
		messageID, err := whatsappService.SendMessage(req.PhoneNumber, req.Message)

		response := SendWhatsAppMessageResponse{
			Success: err == nil,
		}

		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(response)
			return
		}

		response.MessageID = messageID
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	}
}

// SendMealSuggestionToCook sends a meal suggestion to the cook
func SendMealSuggestionToCook(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req SendMealSuggestionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if req.MealName == "" {
			http.Error(w, "meal_name is required", http.StatusBadRequest)
			return
		}

		if len(req.Ingredients) == 0 {
			http.Error(w, "ingredients are required", http.StatusBadRequest)
			return
		}

		// Initialize WhatsApp service
		whatsappService := services.NewWhatsAppService(cfg, db)

		// Send meal suggestion
		messageID, err := whatsappService.SendMealSuggestionToCook(req.MealName, req.Ingredients, req.CookingTime)

		response := SendWhatsAppMessageResponse{
			Success: err == nil,
		}

		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(response)
			return
		}

		response.MessageID = messageID
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	}
}

// SendDailyMenuToCook sends the daily menu to the cook
func SendDailyMenuToCook(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req SendDailyMenuRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if len(req.Menu) == 0 {
			http.Error(w, "menu is required", http.StatusBadRequest)
			return
		}

		// Convert to MealSuggestion models
		var mealSuggestions []models.MealSuggestion
		for _, item := range req.Menu {
			mealSuggestions = append(mealSuggestions, models.MealSuggestion{
				MealName: item.MealName,
			})
		}

		// Initialize WhatsApp service
		whatsappService := services.NewWhatsAppService(cfg, db)

		// Send daily menu
		messageID, err := whatsappService.SendDailyMenu(mealSuggestions)

		response := SendWhatsAppMessageResponse{
			Success: err == nil,
		}

		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(response)
			return
		}

		response.MessageID = messageID
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	}
}

// TestWhatsAppIntegration tests WhatsApp integration
func TestWhatsAppIntegration(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		whatsappService := services.NewWhatsAppService(cfg, db)

		messageID, err := whatsappService.TestSendMessage()

		response := SendWhatsAppMessageResponse{
			Success: err == nil,
		}

		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(response)
			return
		}

		response.MessageID = messageID

		// Also test translation service
		translationService := services.NewTranslationService(cfg)
		testText := "Shopping list: milk, tomato, onion"
		translatedHindi, _ := translationService.Translate(testText, "hi")
		translatedKannada, _ := translationService.Translate(testText, "kn")

		testResult := map[string]interface{}{
			"whatsapp_test": response,
			"translation_test": map[string]string{
				"original": testText,
				"hindi":    translatedHindi,
				"kannada":  translatedKannada,
			},
			"config": map[string]interface{}{
				"whatsapp_test_mode":  cfg.WhatsAppTestMode,
				"twilio_configured":   cfg.TwilioAccountSID != "" && cfg.TwilioAuthToken != "",
				"supported_languages": []string{"en", "hi", "kn"},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(testResult)
	}
}

// GetCookWhatsAppInfo returns cook's WhatsApp information
func GetCookWhatsAppInfo(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookID := "default-cook"

		var profile models.CookProfile
		err := db.QueryRow(`
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
			profile = models.CookProfile{
				CookID:        cookID,
				DishesKnown:   []string{},
				PreferredLang: "en",
				PhoneNumber:   "",
			}
		} else if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Mask phone number for privacy
		maskedPhone := profile.PhoneNumber
		if maskedPhone != "" && len(maskedPhone) > 4 {
			maskedPhone = strings.Repeat("*", len(maskedPhone)-4) + maskedPhone[len(maskedPhone)-4:]
		}

		response := map[string]interface{}{
			"cook_id":             profile.CookID,
			"preferred_language":  profile.PreferredLang,
			"phone_number_set":    profile.PhoneNumber != "",
			"phone_number_masked": maskedPhone,
			"dishes_known_count":  len(profile.DishesKnown),
			"dishes_known":        profile.DishesKnown,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
}

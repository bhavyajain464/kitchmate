package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"kitchenai-backend/internal/models"
	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"

	"github.com/lib/pq"
)

// SendWhatsAppMessageRequest represents the request to send a WhatsApp message
type SendWhatsAppMessageRequest struct {
	PhoneNumber string `json:"phone_number"`
	Message     string `json:"message"`
	DishName    string `json:"dish_name,omitempty"`
	TestMode    bool   `json:"test_mode,omitempty"`
}

// SendWhatsAppMessageResponse is returned for all /whatsapp/* compose flows.
// The client opens whatsapp_url in the user's browser / WhatsApp app; nothing is sent server-side.
type SendWhatsAppMessageResponse struct {
	Success     bool   `json:"success"`
	Message     string `json:"message,omitempty"`      // short status for the UI
	Body        string `json:"body,omitempty"`         // pre-filled WhatsApp message text
	WhatsappURL string `json:"whatsapp_url,omitempty"` // https://wa.me/…?text=…
	Error       string `json:"error,omitempty"`
	MessageID   string `json:"message_id,omitempty"` // legacy: always empty (Twilio removed)
}

// SendMealSuggestionRequest represents the request to send a meal suggestion
type SendMealSuggestionRequest struct {
	MealName     string              `json:"meal_name"`
	Ingredients  []models.Ingredient `json:"ingredients"`
	CookingTime  int                 `json:"cooking_time"`
	Instructions string              `json:"instructions,omitempty"`
	TestMode     bool                `json:"test_mode,omitempty"`
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

// SendWhatsAppMessage returns a wa.me compose link for an arbitrary recipient and message.
func SendWhatsAppMessage(db *sql.DB, cfg *config.Config, cookedLog *services.CookedLogService) http.HandlerFunc {
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

		whatsappService := services.NewWhatsAppService(db)

		body, waURL, err := whatsappService.PrepareGenericWhatsApp(req.PhoneNumber, req.Message)
		response := SendWhatsAppMessageResponse{Success: err == nil}
		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(response)
			return
		}
		response.Message = "Open WhatsApp to send this message."
		response.Body = body
		response.WhatsappURL = waURL
		if cookedLog != nil {
			dish := strings.TrimSpace(req.DishName)
			if dish == "" && strings.TrimSpace(req.Message) != "" {
				dish = strings.TrimSpace(strings.Split(req.Message, "\n")[0])
			}
			if dish != "" {
				cookedLog.LogDishName(r.Context(), getUserID(r), dish, "cook-sent")
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	}
}

// SendMealSuggestionToCook sends a meal suggestion to the cook
func SendMealSuggestionToCook(db *sql.DB, cfg *config.Config, cookedLog *services.CookedLogService) http.HandlerFunc {
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

		whatsappService := services.NewWhatsAppService(db)

		userID := getUserID(r)
		body, waURL, err := whatsappService.PrepareMealSuggestionToCook(userID, req.MealName, req.Ingredients, req.CookingTime, req.Instructions)

		response := SendWhatsAppMessageResponse{Success: err == nil}
		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(response)
			return
		}
		response.Message = "Open WhatsApp to send to your cook."
		response.Body = body
		response.WhatsappURL = waURL
		if cookedLog != nil {
			cookedLog.LogDishName(r.Context(), userID, req.MealName, "meal-sent")
		}
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

		whatsappService := services.NewWhatsAppService(db)

		userID := getUserID(r)
		body, waURL, err := whatsappService.PrepareDailyMenuToCook(userID, mealSuggestions)

		response := SendWhatsAppMessageResponse{Success: err == nil}
		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(response)
			return
		}
		response.Message = "Open WhatsApp to send the daily menu to your cook."
		response.Body = body
		response.WhatsappURL = waURL
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	}
}

// TestWhatsAppIntegration tests WhatsApp integration
func TestWhatsAppIntegration(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		whatsappService := services.NewWhatsAppService(db)

		body, waURL, err := whatsappService.PrepareTestWhatsApp()

		response := SendWhatsAppMessageResponse{Success: err == nil}
		if err != nil {
			response.Error = err.Error()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(response)
			return
		}
		response.Message = "Sample wa.me link (placeholder number)."
		response.Body = body
		response.WhatsappURL = waURL

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
				"whatsapp_compose":    "wa.me links (user sends from their WhatsApp)",
				"supported_languages": []string{"en", "hi", "kn"},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(testResult)
	}
}

// GetCookWhatsAppInfo returns cook's WhatsApp information for the authenticated user
func GetCookWhatsAppInfo(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)

		var profile models.CookProfile
		err := db.QueryRow(`
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
			err = db.QueryRow(`
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
			profile = models.CookProfile{
				CookID:        "",
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

		maskedName := profile.CookName
		if maskedName != "" && len([]rune(maskedName)) > 2 {
			rs := []rune(maskedName)
			maskedName = string(rs[0]) + strings.Repeat("*", len(rs)-2) + string(rs[len(rs)-1])
		}

		response := map[string]interface{}{
			"cook_id":             profile.CookID,
			"cook_name_set":       strings.TrimSpace(profile.CookName) != "",
			"cook_name_masked":    maskedName,
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

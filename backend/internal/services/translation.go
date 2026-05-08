package services

import (
	"fmt"
	"strings"

	"kitchenai-backend/pkg/config"
)

// TranslationService handles language translation
type TranslationService struct {
	config *config.Config
}

// NewTranslationService creates a new translation service
func NewTranslationService(cfg *config.Config) *TranslationService {
	return &TranslationService{
		config: cfg,
	}
}

// Translate translates text to target language
func (s *TranslationService) Translate(text, targetLang string) (string, error) {
	// If Google Translate API key is available, use it
	if s.config.GoogleTranslateKey != "" {
		return s.translateWithGoogle(text, targetLang)
	}

	// Otherwise use built-in dictionary for common kitchen terms
	return s.translateWithDictionary(text, targetLang), nil
}

// translateWithGoogle uses Google Translate API (mock implementation for now)
func (s *TranslationService) translateWithGoogle(text, targetLang string) (string, error) {
	// In a real implementation, you would call Google Cloud Translation API
	// For now, we'll use dictionary fallback
	return s.translateWithDictionary(text, targetLang), nil
}

// translateWithDictionary uses built-in dictionary for common kitchen terms
func (s *TranslationService) translateWithDictionary(text, targetLang string) string {
	// Convert to lowercase for case-insensitive matching
	lowerText := strings.ToLower(text)

	// Dictionary of common kitchen terms
	dictionary := map[string]map[string]string{
		"hi": { // Hindi translations
			"milk":            "दूध",
			"tomato":          "टमाटर",
			"onion":           "प्याज",
			"potato":          "आलू",
			"rice":            "चावल",
			"wheat":           "गेहूं",
			"sugar":           "चीनी",
			"salt":            "नमक",
			"oil":             "तेल",
			"bread":           "ब्रेड",
			"egg":             "अंडा",
			"chicken":         "चिकन",
			"fish":            "मछली",
			"vegetable":       "सब्जी",
			"fruit":           "फल",
			"spices":          "मसाले",
			"breakfast":       "नाश्ता",
			"lunch":           "दोपहर का भोजन",
			"dinner":          "रात का खाना",
			"cook":            "पकाना",
			"prepare":         "तैयार करना",
			"buy":             "खरीदना",
			"expiry":          "समाप्ति तिथि",
			"shopping list":   "खरीदारी सूची",
			"meal suggestion": "भोजन सुझाव",
			"ingredients":     "सामग्री",
			"cooking time":    "पकाने का समय",
			"minutes":         "मिनट",
			"please prepare":  "कृपया तैयार करें",
			"daily menu":      "दैनिक मेनू",
			"date":            "तारीख",
			"meals":           "भोजन",
			"thank you":       "धन्यवाद",
		},
		"kn": { // Kannada translations
			"milk":            "ಹಾಲು",
			"tomato":          "ಟೊಮ್ಯಾಟೊ",
			"onion":           "ಈರುಳ್ಳಿ",
			"potato":          "ಆಲೂಗಡ್ಡೆ",
			"rice":            "ಅಕ್ಕಿ",
			"wheat":           "ಗೋಧಿ",
			"sugar":           "ಸಕ್ಕರೆ",
			"salt":            "ಉಪ್ಪು",
			"oil":             "ಎಣ್ಣೆ",
			"bread":           "ಬ್ರೆಡ್",
			"egg":             "ಮೊಟ್ಟೆ",
			"chicken":         "ಕೋಳಿ ಮಾಂಸ",
			"fish":            "ಮೀನು",
			"vegetable":       "ತರಕಾರಿ",
			"fruit":           "ಹಣ್ಣು",
			"spices":          "ಮಸಾಲೆ",
			"breakfast":       "ಉಪಹಾರ",
			"lunch":           "ಮಧ್ಯಾಹ್ನ ಊಟ",
			"dinner":          "ರಾತ್ರಿ ಊಟ",
			"cook":            "ಅಡುಗೆ ಮಾಡಿ",
			"prepare":         "ಸಿದ್ಧಪಡಿಸಿ",
			"buy":             "ಖರೀದಿಸಿ",
			"expiry":          "ಮುಕ್ತಾಯ ದಿನಾಂಕ",
			"shopping list":   "ಶಾಪಿಂಗ್ ಪಟ್ಟಿ",
			"meal suggestion": "ಊಟದ ಸಲಹೆ",
			"ingredients":     "ಪದಾರ್ಥಗಳು",
			"cooking time":    "ಅಡುಗೆ ಸಮಯ",
			"minutes":         "ನಿಮಿಷಗಳು",
			"please prepare":  "ದಯವಿಟ್ಟು ತಯಾರಿಸಿ",
			"daily menu":      "ದೈನಂದಿನ ಮೆನು",
			"date":            "ದಿನಾಂಕ",
			"meals":           "ಊಟಗಳು",
			"thank you":       "ಧನ್ಯವಾದಗಳು",
		},
	}

	// Get translation map for target language
	langMap := dictionary[targetLang]
	if langMap == nil {
		// Return original text if language not supported
		return text
	}

	// Check for exact matches first
	if translated, ok := langMap[lowerText]; ok {
		return translated
	}

	// Try to translate word by word
	words := strings.Fields(text)
	var translatedWords []string

	for _, word := range words {
		lowerWord := strings.ToLower(word)
		if translated, ok := langMap[lowerWord]; ok {
			translatedWords = append(translatedWords, translated)
		} else {
			translatedWords = append(translatedWords, word)
		}
	}

	return strings.Join(translatedWords, " ")
}

// TranslateMealSuggestion translates a meal suggestion to target language
func (s *TranslationService) TranslateMealSuggestion(mealName string, ingredients []string, cookingTime int, targetLang string) string {
	// Translate meal name
	translatedMeal := s.translateWithDictionary(mealName, targetLang)

	// Translate ingredients
	var translatedIngredients []string
	for _, ing := range ingredients {
		translatedIngredients = append(translatedIngredients, s.translateWithDictionary(ing, targetLang))
	}

	// Get time translation
	timeText := fmt.Sprintf("%d minutes", cookingTime)
	translatedTime := s.translateWithDictionary(timeText, targetLang)

	// Build message based on language
	templates := map[string]string{
		"hi": `भोजन सुझाव: %s

सामग्री:
%s

पकाने का समय: %s

कृपया तैयार करें %s`,
		"kn": `ಊಟದ ಸಲಹೆ: %s

ಪದಾರ್ಥಗಳು:
%s

ಅಡುಗೆ ಸಮಯ: %s

ದಯವಿಟ್ಟು ತಯಾರಿಸಿ %s`,
		"en": `Meal Suggestion: %s

Ingredients:
%s

Cooking Time: %s

Please prepare %s`,
	}

	template := templates[targetLang]
	if template == "" {
		template = templates["en"]
	}

	return fmt.Sprintf(template,
		translatedMeal,
		strings.Join(translatedIngredients, "\n"),
		translatedTime,
		translatedMeal)
}

// TranslateShoppingList translates shopping list to target language
func (s *TranslationService) TranslateShoppingList(items []string, targetLang string) string {
	// Translate each item
	var translatedItems []string
	for _, item := range items {
		translatedItems = append(translatedItems, s.translateWithDictionary(item, targetLang))
	}

	// Build message
	headers := map[string]string{
		"hi": "🛒 खरीदारी सूची:\n\n",
		"kn": "🛒 ಶಾಪಿಂಗ್ ಪಟ್ಟಿ:\n\n",
		"en": "🛒 Shopping List:\n\n",
	}

	footers := map[string]string{
		"hi": "\n\nकृपया इन वस्तुओं को खरीदें।",
		"kn": "\n\nದಯವಿಟ್ಟು ಈ ವಸ್ತುಗಳನ್ನು ಖರೀದಿಸಿ.",
		"en": "\n\nPlease purchase these items.",
	}

	header := headers[targetLang]
	if header == "" {
		header = headers["en"]
	}

	footer := footers[targetLang]
	if footer == "" {
		footer = footers["en"]
	}

	var list strings.Builder
	list.WriteString(header)

	for i, item := range translatedItems {
		list.WriteString(fmt.Sprintf("%d. %s\n", i+1, item))
	}

	list.WriteString(footer)
	return list.String()
}

// SupportedLanguages returns list of supported language codes
func (s *TranslationService) SupportedLanguages() []string {
	return []string{"en", "hi", "kn"}
}

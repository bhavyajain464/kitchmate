package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port               string
	DatabaseURL        string
	Environment        string
	GeminiAPIKey       string
	GeminiModel        string
	TwilioAccountSID   string
	TwilioAuthToken    string
	TwilioWhatsAppFrom string
	WhatsAppTestMode   bool
	GoogleTranslateKey string
	GoogleClientID     string
	SessionTokenSecret string
}

func Load() (*Config, error) {
	port := getEnv("PORT", "8080")
	databaseURL := getEnv("DATABASE_URL", "postgres://user:password@localhost:5432/kitchenai?sslmode=disable")
	environment := getEnv("ENVIRONMENT", "development")
	geminiAPIKey := getEnv("GEMINI_API_KEY", "")
	geminiModel := getEnv("GEMINI_MODEL", "gemini-1.5-pro")
	twilioAccountSID := getEnv("TWILIO_ACCOUNT_SID", "")
	twilioAuthToken := getEnv("TWILIO_AUTH_TOKEN", "")
	twilioWhatsAppFrom := getEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886") // Twilio sandbox number
	whatsAppTestMode := getEnvBool("WHATSAPP_TEST_MODE", true)
	googleTranslateKey := getEnv("GOOGLE_TRANSLATE_KEY", "")
	googleClientID := getEnv("GOOGLE_CLIENT_ID", "")
	sessionTokenSecret := getEnv("SESSION_TOKEN_SECRET", "kitchenai-dev-session-secret")

	return &Config{
		Port:               port,
		DatabaseURL:        databaseURL,
		Environment:        environment,
		GeminiAPIKey:       geminiAPIKey,
		GeminiModel:        geminiModel,
		TwilioAccountSID:   twilioAccountSID,
		TwilioAuthToken:    twilioAuthToken,
		TwilioWhatsAppFrom: twilioWhatsAppFrom,
		WhatsAppTestMode:   whatsAppTestMode,
		GoogleTranslateKey: googleTranslateKey,
		GoogleClientID:     googleClientID,
		SessionTokenSecret: sessionTokenSecret,
	}, nil
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func getEnvInt(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}

	intValue, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	return intValue
}

func getEnvBool(key string, defaultValue bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}

	boolValue, err := strconv.ParseBool(value)
	if err != nil {
		return defaultValue
	}
	return boolValue
}

package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// DefaultGroqModel is used for meals, bill scan, shelf-life, WhatsApp NLU, and diet analysis.
// Qwen with reasoning_effort=none (set in groqDoChat) avoids burning max_tokens on <think>.
const DefaultGroqModel = "qwen/qwen3.6-27b"

type Config struct {
	Port            string
	DatabaseURL     string
	Environment     string
	GeminiAPIKey    string
	GeminiModel     string
	GroqAPIKey      string   // first key; prefer PickGroqAPIKey() for API calls
	GroqAPIKeys     []string // from comma-separated GROQ_API_KEY
	GroqModel       string
	GroqNLUModel string // legacy env GROQ_NLU_MODEL (EffectiveGroqModel uses GROQ_MODEL)
	// LLMProvider is "gemini" or "groq" (default groq). One provider per request — no cross-provider fallback.
	LLMProvider           string
	GoogleVisionAPIKey    string // GOOGLE_VISION_API_KEY — GCP Cloud Vision API (not AI Studio GEMINI_API_KEY)
	GoogleTranslateKey    string
	GoogleWebClientID     string
	GoogleIOSClientID     string
	GoogleAndroidClientID string
	SessionTokenSecret    string
	KafkaBrokers            string
	KafkaTopicShelfLife     string
	KafkaTopicDietAnalysis  string
	KafkaSASLEnabled        bool
	KafkaSASLMechanism    string
	KafkaUsername         string
	KafkaPassword         string
	KafkaTLSEnabled       bool
	KafkaCAFile           string // path to PEM file (local/dev)
	KafkaCAPem            string // inline PEM (Cloud Run via GitHub Secrets)

	// Kafka throughput / concurrency tuning (defaults favor minimal broker & CPU load).
	KafkaWriterBatchSize             int
	KafkaWriterBatchBytes            int
	KafkaWriterBatchTimeoutSec       int
	KafkaWriterMaxAttempts           int
	KafkaWriterAsync                 bool
	KafkaConsumerMaxBytes            int
	KafkaConsumerMaxWaitSec          int
	KafkaConsumerCommitIntervalSec   int
	KafkaConsumerReadBackoffMinMs    int
	KafkaConsumerReadBackoffMaxMs    int
	KafkaConsumerHeartbeatSec        int
	KafkaConsumerSessionTimeoutSec   int
	KafkaConsumerJoinGroupBackoffSec int
	KafkaConsumerErrorBackoffSec     int
	KafkaConsumerQueueCapacity       int
	KafkaTopicPartitions             int

	// Postgres pool (low defaults to keep load off shared / remote databases).
	DatabaseMaxOpenConns               int
	DatabaseMaxIdleConns               int
	DatabaseConnMaxLifetimeMin         int
	DatabaseConnMaxIdleSec             int
	KafkaConsumerGeminiBatchSize       int
	KafkaConsumerPauseBetweenBatchesMs int

	// Redis (optional): caches per-user cooked dish history (last 15 days).
	RedisURL string
	// MealPlanCacheTTL is how long kitchen week plans stay in Redis (default 4h).
	MealPlanCacheTTL time.Duration

	// Razorpay premium checkout (RAZORPAY_ENV=staging|production selects key pair).
	Razorpay RazorpayConfig

	// Commerce (Phase 0): grocery "order this list" deep-links. Free/no-partnership —
	// opens a quick-commerce app; affiliate templates are blank until you join a network.
	Commerce CommerceConfig

	// AdminAPIKey secures /api/v1/admin/* (X-Admin-Key header). Empty disables admin routes.
	AdminAPIKey string

	// AdminPanelEmails allowlists Google accounts for the in-app ops panel (/api/v1/panel/*).
	AdminPanelEmails []string

	// SMTP for nightly diet digest emails (optional).
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	SMTPFrom string

	// ExpoAccessToken authorizes server-side push via Expo Push API (EXPO_ACCESS_TOKEN).
	ExpoAccessToken string

	// Force-update gates (0 build = disabled). Bump on each required store release.
	MinAndroidVersion string
	MinIOSVersion     string
	MinAndroidBuild   int
	MinIOSBuild       int
	AppUpdateMessage  string
	PlayStoreURL      string
	AppStoreURL       string
	DishImagesCDNURL  string
}

// AppVersionEnforcementEnabled is true when any native minimum is configured.
func (c *Config) AppVersionEnforcementEnabled() bool {
	if c == nil {
		return false
	}
	return c.MinAndroidBuild > 0 || c.MinIOSBuild > 0 ||
		strings.TrimSpace(c.MinAndroidVersion) != "" ||
		strings.TrimSpace(c.MinIOSVersion) != ""
}

// SMTPConfigured reports whether outbound email can be sent.
func (c *Config) SMTPConfigured() bool {
	return c != nil && strings.TrimSpace(c.SMTPHost) != "" && strings.TrimSpace(c.SMTPFrom) != ""
}

// ExpoPushConfigured reports whether server can send Expo push notifications.
func (c *Config) ExpoPushConfigured() bool {
	return c != nil && strings.TrimSpace(c.ExpoAccessToken) != ""
}

// RazorpayConfig holds credentials for the active Razorpay environment.
type RazorpayConfig struct {
	// Env is "staging" (test keys) or "production" (live keys).
	Env             string
	KeyID           string
	KeySecret       string
	WebhookSecret   string
	BillingAmount   int // legacy env fallback paise (catalog defines real prices)
	BillingCurrency string
}

// Enabled reports whether checkout can be offered (key id + secret set).
func (r RazorpayConfig) Enabled() bool {
	return strings.TrimSpace(r.KeyID) != "" && strings.TrimSpace(r.KeySecret) != ""
}

// EffectiveGroqModel returns the primary Groq model (GROQ_MODEL), with a stable default.
func (c *Config) EffectiveGroqModel() string {
	if c == nil {
		return DefaultGroqModel
	}
	if m := strings.TrimSpace(c.GroqModel); m != "" {
		return m
	}
	return DefaultGroqModel
}

func Load() (*Config, error) {
	port := getEnv("PORT", "8080")
	databaseURL := getEnv("DATABASE_URL", "postgres://user:password@localhost:5432/kitchenai?sslmode=disable")
	environment := getEnv("ENVIRONMENT", "development")
	geminiAPIKey := getEnv("GEMINI_API_KEY", "")
	geminiModel := getEnv("GEMINI_MODEL", "gemini-1.5-pro")
	groqAPIKeys := parseGroqAPIKeys(getEnv("GROQ_API_KEY", ""))
	groqAPIKey := ""
	if len(groqAPIKeys) > 0 {
		groqAPIKey = groqAPIKeys[0]
	}
	groqModel := getEnv("GROQ_MODEL", DefaultGroqModel)
	groqNLUModel := getEnv("GROQ_NLU_MODEL", DefaultGroqModel)
	googleVisionAPIKey := strings.TrimSpace(getEnv("GOOGLE_VISION_API_KEY", ""))
	llmProvider := strings.ToLower(strings.TrimSpace(getEnv("LLM_PROVIDER", "groq")))
	if llmProvider != "gemini" && llmProvider != "groq" {
		llmProvider = "groq"
	}
	googleTranslateKey := getEnv("GOOGLE_TRANSLATE_KEY", "")
	googleWebClientID := getEnv("GOOGLE_WEB_CLIENT_ID", "")
	googleIOSClientID := getEnv("GOOGLE_IOS_CLIENT_ID", "")
	googleAndroidClientID := getEnv("GOOGLE_ANDROID_CLIENT_ID", "")
	sessionTokenSecret := getEnv("SESSION_TOKEN_SECRET", "kitchenai-dev-session-secret")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:9092")
	if !getEnvBool("KAFKA_ENABLED", true) {
		kafkaBrokers = ""
	}
	kafkaTopicShelfLife := getEnv("KAFKA_TOPIC_SHELFLIFE", "shelf-life-estimate")
	kafkaTopicDietAnalysis := getEnv("KAFKA_TOPIC_DIET_ANALYSIS", "diet-meal-analysis")
	kafkaSASLEnabled := getEnvBool("KAFKA_SASL_ENABLED", false)
	kafkaSASLMechanism := strings.ToUpper(strings.TrimSpace(getEnv("KAFKA_SASL_MECHANISM", "PLAIN")))
	kafkaUsername := getEnv("KAFKA_USERNAME", "")
	kafkaPassword := getEnv("KAFKA_PASSWORD", "")
	kafkaTLSEnabled := getEnvBool("KAFKA_TLS_ENABLED", false)
	kafkaCAFile := getEnv("KAFKA_CA_FILE", "")
	kafkaCAPem := getEnv("KAFKA_CA_PEM", "")

	// Producer: small batches, long flush window, synchronous writes by default (no extra async fire-and-forget).
	kafkaWriterBatchSize := getEnvInt("KAFKA_WRITER_BATCH_SIZE", 1)
	if kafkaWriterBatchSize < 1 {
		kafkaWriterBatchSize = 1
	}
	kafkaWriterBatchBytes := getEnvInt("KAFKA_WRITER_BATCH_BYTES", 4096)
	if kafkaWriterBatchBytes < 1024 {
		kafkaWriterBatchBytes = 1024
	}
	kafkaWriterBatchTimeoutSec := getEnvInt("KAFKA_WRITER_BATCH_TIMEOUT_SEC", 5)
	if kafkaWriterBatchTimeoutSec < 1 {
		kafkaWriterBatchTimeoutSec = 1
	}
	kafkaWriterMaxAttempts := getEnvInt("KAFKA_WRITER_MAX_ATTEMPTS", 2)
	if kafkaWriterMaxAttempts < 1 {
		kafkaWriterMaxAttempts = 1
	}
	kafkaWriterAsync := getEnvBool("KAFKA_WRITER_ASYNC", false)

	// Consumer: small fetches, long idle waits, infrequent commits & heartbeats, slow backoff on errors.
	kafkaConsumerMaxBytes := getEnvInt("KAFKA_CONSUMER_MAX_BYTES", 262144)
	if kafkaConsumerMaxBytes < 1024 {
		kafkaConsumerMaxBytes = 1024
	}
	kafkaConsumerMaxWaitSec := getEnvInt("KAFKA_CONSUMER_MAX_WAIT_SEC", 10)
	if kafkaConsumerMaxWaitSec < 1 {
		kafkaConsumerMaxWaitSec = 1
	}
	kafkaConsumerCommitIntervalSec := getEnvInt("KAFKA_CONSUMER_COMMIT_INTERVAL_SEC", 30)
	if kafkaConsumerCommitIntervalSec < 1 {
		kafkaConsumerCommitIntervalSec = 1
	}
	kafkaConsumerReadBackoffMinMs := getEnvInt("KAFKA_CONSUMER_READ_BACKOFF_MIN_MS", 2000)
	if kafkaConsumerReadBackoffMinMs < 100 {
		kafkaConsumerReadBackoffMinMs = 100
	}
	kafkaConsumerReadBackoffMaxMs := getEnvInt("KAFKA_CONSUMER_READ_BACKOFF_MAX_MS", 8000)
	if kafkaConsumerReadBackoffMaxMs < kafkaConsumerReadBackoffMinMs {
		kafkaConsumerReadBackoffMaxMs = kafkaConsumerReadBackoffMinMs
	}
	kafkaConsumerHeartbeatSec := getEnvInt("KAFKA_CONSUMER_HEARTBEAT_SEC", 10)
	if kafkaConsumerHeartbeatSec < 1 {
		kafkaConsumerHeartbeatSec = 1
	}
	kafkaConsumerSessionTimeoutSec := getEnvInt("KAFKA_CONSUMER_SESSION_TIMEOUT_SEC", 60)
	if kafkaConsumerSessionTimeoutSec < kafkaConsumerHeartbeatSec*3 {
		kafkaConsumerSessionTimeoutSec = kafkaConsumerHeartbeatSec * 3
	}
	kafkaConsumerJoinGroupBackoffSec := getEnvInt("KAFKA_CONSUMER_JOIN_GROUP_BACKOFF_SEC", 10)
	if kafkaConsumerJoinGroupBackoffSec < 1 {
		kafkaConsumerJoinGroupBackoffSec = 1
	}
	kafkaConsumerErrorBackoffSec := getEnvInt("KAFKA_CONSUMER_ERROR_BACKOFF_SEC", 10)
	if kafkaConsumerErrorBackoffSec < 1 {
		kafkaConsumerErrorBackoffSec = 1
	}
	kafkaConsumerQueueCapacity := getEnvInt("KAFKA_CONSUMER_QUEUE_CAPACITY", 1)
	if kafkaConsumerQueueCapacity < 1 {
		kafkaConsumerQueueCapacity = 1
	}
	kafkaTopicPartitions := getEnvInt("KAFKA_TOPIC_PARTITIONS", 1)
	if kafkaTopicPartitions < 1 {
		kafkaTopicPartitions = 1
	}

	dbMaxOpen := getEnvInt("DB_MAX_OPEN_CONNS", 6)
	if dbMaxOpen < 1 {
		dbMaxOpen = 1
	}
	dbMaxIdle := getEnvInt("DB_MAX_IDLE_CONNS", 2)
	if dbMaxIdle < 0 {
		dbMaxIdle = 0
	}
	if dbMaxIdle > dbMaxOpen {
		dbMaxIdle = dbMaxOpen
	}
	dbConnMaxLifeMin := getEnvInt("DB_CONN_MAX_LIFETIME_MIN", 5)
	if dbConnMaxLifeMin < 1 {
		dbConnMaxLifeMin = 1
	}
	dbConnMaxIdleSec := getEnvInt("DB_CONN_MAX_IDLE_SEC", 90)
	if dbConnMaxIdleSec < 0 {
		dbConnMaxIdleSec = 0
	}
	kafkaConsumerGeminiBatch := getEnvInt("KAFKA_CONSUMER_GEMINI_BATCH_SIZE", 12)
	if kafkaConsumerGeminiBatch < 1 {
		kafkaConsumerGeminiBatch = 1
	}
	kafkaConsumerPauseBetweenBatchesMs := getEnvInt("KAFKA_CONSUMER_PAUSE_BETWEEN_BATCHES_MS", 150)
	if kafkaConsumerPauseBetweenBatchesMs < 0 {
		kafkaConsumerPauseBetweenBatchesMs = 0
	}
	redisURL := getEnv("REDIS_URL", "")
	mealPlanTTLHours := getEnvInt("MEAL_PLAN_CACHE_TTL_HOURS", 4)
	if mealPlanTTLHours < 1 {
		mealPlanTTLHours = 4
	}
	razorpay := loadRazorpayConfig()
	adminAPIKey := getEnv("ADMIN_API_KEY", "")
	adminPanelEmails := parseCommaSeparatedEmails(getEnv("ADMIN_PANEL_EMAILS", ""))
	smtpPort := getEnvInt("SMTP_PORT", 587)

	return &Config{
		Port:                               port,
		DatabaseURL:                        databaseURL,
		Environment:                        environment,
		GeminiAPIKey:                       geminiAPIKey,
		GeminiModel:                        geminiModel,
		GroqAPIKey:                         groqAPIKey,
		GroqAPIKeys:                        groqAPIKeys,
		GroqModel:                          groqModel,
		GroqNLUModel:                       groqNLUModel,
		LLMProvider:                        llmProvider,
		GoogleVisionAPIKey:                 googleVisionAPIKey,
		GoogleTranslateKey:                 googleTranslateKey,
		GoogleWebClientID:                  googleWebClientID,
		GoogleIOSClientID:                  googleIOSClientID,
		GoogleAndroidClientID:              googleAndroidClientID,
		SessionTokenSecret:                 sessionTokenSecret,
		KafkaBrokers:                       kafkaBrokers,
		KafkaTopicShelfLife:                kafkaTopicShelfLife,
		KafkaTopicDietAnalysis:             kafkaTopicDietAnalysis,
		KafkaSASLEnabled:                   kafkaSASLEnabled,
		KafkaSASLMechanism:                 kafkaSASLMechanism,
		KafkaUsername:                      kafkaUsername,
		KafkaPassword:                      kafkaPassword,
		KafkaTLSEnabled:                    kafkaTLSEnabled,
		KafkaCAFile:                        kafkaCAFile,
		KafkaCAPem:                         kafkaCAPem,
		KafkaWriterBatchSize:               kafkaWriterBatchSize,
		KafkaWriterBatchBytes:              kafkaWriterBatchBytes,
		KafkaWriterBatchTimeoutSec:         kafkaWriterBatchTimeoutSec,
		KafkaWriterMaxAttempts:             kafkaWriterMaxAttempts,
		KafkaWriterAsync:                   kafkaWriterAsync,
		KafkaConsumerMaxBytes:              kafkaConsumerMaxBytes,
		KafkaConsumerMaxWaitSec:            kafkaConsumerMaxWaitSec,
		KafkaConsumerCommitIntervalSec:     kafkaConsumerCommitIntervalSec,
		KafkaConsumerReadBackoffMinMs:      kafkaConsumerReadBackoffMinMs,
		KafkaConsumerReadBackoffMaxMs:      kafkaConsumerReadBackoffMaxMs,
		KafkaConsumerHeartbeatSec:          kafkaConsumerHeartbeatSec,
		KafkaConsumerSessionTimeoutSec:     kafkaConsumerSessionTimeoutSec,
		KafkaConsumerJoinGroupBackoffSec:   kafkaConsumerJoinGroupBackoffSec,
		KafkaConsumerErrorBackoffSec:       kafkaConsumerErrorBackoffSec,
		KafkaConsumerQueueCapacity:         kafkaConsumerQueueCapacity,
		KafkaTopicPartitions:               kafkaTopicPartitions,
		DatabaseMaxOpenConns:               dbMaxOpen,
		DatabaseMaxIdleConns:               dbMaxIdle,
		DatabaseConnMaxLifetimeMin:         dbConnMaxLifeMin,
		DatabaseConnMaxIdleSec:             dbConnMaxIdleSec,
		KafkaConsumerGeminiBatchSize:       kafkaConsumerGeminiBatch,
		KafkaConsumerPauseBetweenBatchesMs: kafkaConsumerPauseBetweenBatchesMs,
		RedisURL:                           redisURL,
		MealPlanCacheTTL:                   time.Duration(mealPlanTTLHours) * time.Hour,
		Razorpay:                           razorpay,
		Commerce:                           loadCommerceConfig(),
		AdminAPIKey:                        adminAPIKey,
		AdminPanelEmails:                   adminPanelEmails,
		SMTPHost:                           strings.TrimSpace(getEnv("SMTP_HOST", "")),
		SMTPPort:                           smtpPort,
		SMTPUser:                           getEnv("SMTP_USER", ""),
		SMTPPass:                           getEnv("SMTP_PASS", ""),
		SMTPFrom:                           strings.TrimSpace(getEnv("SMTP_FROM", "")),
		ExpoAccessToken:                    strings.TrimSpace(getEnv("EXPO_ACCESS_TOKEN", "")),
		MinAndroidVersion:                  strings.TrimSpace(getEnv("MIN_ANDROID_VERSION", "")),
		MinIOSVersion:                      strings.TrimSpace(getEnv("MIN_IOS_VERSION", "")),
		MinAndroidBuild:                    getEnvInt("MIN_ANDROID_BUILD", 0),
		MinIOSBuild:                        getEnvInt("MIN_IOS_BUILD", 0),
		AppUpdateMessage:                   strings.TrimSpace(getEnv("APP_UPDATE_MESSAGE", "A new version of Rasoibuddy is required. Please update from the store to continue.")),
		PlayStoreURL:                       strings.TrimSpace(getEnv("PLAY_STORE_URL", "")),
		AppStoreURL:                        strings.TrimSpace(getEnv("APP_STORE_URL", "")),
		DishImagesCDNURL:                   strings.TrimRight(strings.TrimSpace(getEnv("DISH_IMAGES_CDN_URL", "")), "/"),
	}, nil
}

// loadRazorpayConfig picks staging vs production credentials from RAZORPAY_ENV.
func loadRazorpayConfig() RazorpayConfig {
	env := strings.ToLower(strings.TrimSpace(getEnv("RAZORPAY_ENV", "staging")))
	if env != "production" {
		env = "staging"
	}
	amount := getEnvInt("RAZORPAY_PREMIUM_AMOUNT_PAISE", 49900)
	if amount < 100 {
		amount = 100
	}
	currency := strings.ToUpper(strings.TrimSpace(getEnv("RAZORPAY_PREMIUM_CURRENCY", "INR")))
	if currency == "" {
		currency = "INR"
	}

	var keyID, keySecret, webhookSecret string
	if env == "production" {
		keyID = getEnv("RAZORPAY_KEY_ID_PRODUCTION", "")
		keySecret = getEnv("RAZORPAY_KEY_SECRET_PRODUCTION", "")
		webhookSecret = getEnv("RAZORPAY_WEBHOOK_SECRET_PRODUCTION", "")
	} else {
		keyID = getEnv("RAZORPAY_KEY_ID_STAGING", "")
		keySecret = getEnv("RAZORPAY_KEY_SECRET_STAGING", "")
		webhookSecret = getEnv("RAZORPAY_WEBHOOK_SECRET_STAGING", "")
	}

	return RazorpayConfig{
		Env:             env,
		KeyID:           keyID,
		KeySecret:       keySecret,
		WebhookSecret:   webhookSecret,
		BillingAmount:   amount,
		BillingCurrency: currency,
	}
}

func (c *Config) ValidateKafkaAuth() error {
	if c == nil || strings.TrimSpace(c.KafkaBrokers) == "" {
		return nil
	}
	if c.KafkaSASLEnabled {
		if c.KafkaSASLMechanism != "PLAIN" {
			return fmt.Errorf("unsupported KAFKA_SASL_MECHANISM %q", c.KafkaSASLMechanism)
		}
		if strings.TrimSpace(c.KafkaUsername) == "" {
			return fmt.Errorf("KAFKA_SASL_ENABLED=true but KAFKA_USERNAME is empty")
		}
		if strings.TrimSpace(c.KafkaPassword) == "" {
			return fmt.Errorf("KAFKA_SASL_ENABLED=true but KAFKA_PASSWORD is empty")
		}
	}
	if c.KafkaTLSEnabled && strings.TrimSpace(c.KafkaCAFile) == "" && strings.TrimSpace(c.KafkaCAPem) == "" {
		return fmt.Errorf("KAFKA_TLS_ENABLED=true but KAFKA_CA_FILE and KAFKA_CA_PEM are both empty")
	}
	return nil
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

func parseCommaSeparatedEmails(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	raw = strings.ReplaceAll(raw, ";", ",")
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.ToLower(strings.TrimSpace(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

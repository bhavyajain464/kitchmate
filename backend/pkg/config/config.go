package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port                string
	DatabaseURL         string
	Environment         string
	GeminiAPIKey        string
	GeminiModel         string
	TwilioAccountSID    string
	TwilioAuthToken     string
	TwilioWhatsAppFrom  string
	WhatsAppTestMode    bool
	GoogleTranslateKey  string
	GoogleClientID      string
	SessionTokenSecret  string
	KafkaBrokers        string
	KafkaTopicShelfLife string

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
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:9092")
	if !getEnvBool("KAFKA_ENABLED", true) {
		kafkaBrokers = ""
	}
	kafkaTopicShelfLife := getEnv("KAFKA_TOPIC_SHELFLIFE", "shelf-life-estimate")

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

	return &Config{
		Port:                               port,
		DatabaseURL:                        databaseURL,
		Environment:                        environment,
		GeminiAPIKey:                       geminiAPIKey,
		GeminiModel:                        geminiModel,
		TwilioAccountSID:                   twilioAccountSID,
		TwilioAuthToken:                    twilioAuthToken,
		TwilioWhatsAppFrom:                 twilioWhatsAppFrom,
		WhatsAppTestMode:                   whatsAppTestMode,
		GoogleTranslateKey:                 googleTranslateKey,
		GoogleClientID:                     googleClientID,
		SessionTokenSecret:                 sessionTokenSecret,
		KafkaBrokers:                       kafkaBrokers,
		KafkaTopicShelfLife:                kafkaTopicShelfLife,
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

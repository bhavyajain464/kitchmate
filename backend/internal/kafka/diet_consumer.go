package kafka

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"

	kafkago "github.com/segmentio/kafka-go"
)

const maxDietAnalysisProcessAttempts = 3

// StartDietAnalysisConsumer enriches cooked meals with per-meal Groq nutrition.
func StartDietAnalysisConsumer(db *sql.DB, cfg *config.Config) {
	if cfg == nil || db == nil {
		return
	}
	brokers := strings.Split(cfg.KafkaBrokers, ",")
	topic := strings.TrimSpace(cfg.KafkaTopicDietAnalysis)
	if len(brokers) == 0 || strings.TrimSpace(brokers[0]) == "" || topic == "" {
		log.Printf("[diet-analysis-consumer] disabled (missing brokers or KAFKA_TOPIC_DIET_ANALYSIS)")
		return
	}

	nutrition := services.NewMealNutritionService(db)

	go func() {
		dialer, err := newDialer(cfg)
		if err != nil {
			log.Printf("[diet-analysis-consumer] disabled: %v", err)
			return
		}

		ensureTopicExists(dialer, brokers, topic, cfg.KafkaTopicPartitions)

		readBackoffMin := time.Duration(cfg.KafkaConsumerReadBackoffMinMs) * time.Millisecond
		readBackoffMax := time.Duration(cfg.KafkaConsumerReadBackoffMaxMs) * time.Millisecond
		errBackoff := time.Duration(cfg.KafkaConsumerErrorBackoffSec) * time.Second

		reader := kafkago.NewReader(kafkago.ReaderConfig{
			Dialer:                dialer,
			Brokers:               brokers,
			Topic:                 topic,
			GroupID:               "diet-meal-analysis-group",
			MinBytes:              1,
			MaxBytes:              cfg.KafkaConsumerMaxBytes,
			MaxWait:               time.Duration(cfg.KafkaConsumerMaxWaitSec) * time.Second,
			ReadBatchTimeout:      30 * time.Second,
			QueueCapacity:         cfg.KafkaConsumerQueueCapacity,
			CommitInterval:        time.Duration(cfg.KafkaConsumerCommitIntervalSec) * time.Second,
			HeartbeatInterval:     time.Duration(cfg.KafkaConsumerHeartbeatSec) * time.Second,
			SessionTimeout:        time.Duration(cfg.KafkaConsumerSessionTimeoutSec) * time.Second,
			JoinGroupBackoff:      time.Duration(cfg.KafkaConsumerJoinGroupBackoffSec) * time.Second,
			ReadBackoffMin:        readBackoffMin,
			ReadBackoffMax:        readBackoffMax,
			ReadLagInterval:       -1,
			MaxAttempts:           2,
			StartOffset:           kafkago.LastOffset,
			WatchPartitionChanges: false,
			Logger:                kafkago.LoggerFunc(func(msg string, a ...interface{}) {}),
			ErrorLogger:           kafkago.LoggerFunc(log.Printf),
		})

		log.Printf("[diet-analysis-consumer] listening topic=%s group=diet-meal-analysis-group", topic)
		for {
			msg, err := reader.ReadMessage(context.Background())
			if err != nil {
				log.Printf("[diet-analysis-consumer] read error: %v", err)
				time.Sleep(errBackoff)
				continue
			}
			processDietAnalysisMessage(db, cfg, nutrition, msg.Value)
		}
	}()

	log.Printf("[diet-analysis-consumer] starting in background for topic %s", topic)
}

func processDietAnalysisMessage(db *sql.DB, cfg *config.Config, nutrition *services.MealNutritionService, raw []byte) {
	var event DietAnalysisEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		log.Printf("[diet-analysis-consumer] unmarshal error: %v", err)
		return
	}
	cookedLogID := strings.TrimSpace(event.CookedLogID)
	userID := strings.TrimSpace(event.UserID)
	if cookedLogID == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	existing, err := nutrition.GetByCookedLogID(ctx, cookedLogID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		log.Printf("[diet-analysis-consumer] load status cooked_log=%s: %v", cookedLogID, err)
	}
	if existing != nil && existing.Status == services.NutritionStatusCompleted {
		return
	}
	if existing != nil && existing.AttemptCount >= maxDietAnalysisProcessAttempts && existing.Status == services.NutritionStatusFailed {
		log.Printf("[diet-analysis-consumer] skipping terminal failure cooked_log=%s attempts=%d", cookedLogID, existing.AttemptCount)
		return
	}

	if err := nutrition.EnqueuePending(ctx, cookedLogID, userID); err != nil {
		log.Printf("[diet-analysis-consumer] enqueue pending cooked_log=%s: %v", cookedLogID, err)
	}

	claimed, err := nutrition.MarkProcessing(ctx, cookedLogID)
	if err != nil {
		log.Printf("[diet-analysis-consumer] mark processing cooked_log=%s: %v", cookedLogID, err)
		return
	}
	if !claimed {
		return
	}

	entry, entryUserID, err := nutrition.LoadCookedLogForAnalysis(ctx, cookedLogID)
	if err != nil {
		_ = nutrition.MarkFailed(ctx, cookedLogID, err.Error())
		log.Printf("[diet-analysis-consumer] load cooked_log=%s: %v", cookedLogID, err)
		return
	}
	if userID == "" {
		userID = entryUserID
	}
	if !services.IsEatenLogSource(entry.Source) {
		_ = nutrition.MarkFailed(ctx, cookedLogID, "skipped non-eaten source")
		return
	}

	prefs, _ := services.LoadUserPrefs(db, userID)
	var lastErr error
	for attempt := 1; attempt <= maxDietAnalysisProcessAttempts; attempt++ {
		est, model, err := services.GroqMealNutrition(ctx, cfg, entry, prefs)
		if err == nil && est != nil {
			if saveErr := nutrition.SaveCompleted(ctx, cookedLogID, model, est.Totals(), est.Micronutrients); saveErr != nil {
				log.Printf("[diet-analysis-consumer] save cooked_log=%s: %v", cookedLogID, saveErr)
				return
			}
			log.Printf("[diet-analysis-consumer] completed cooked_log=%s kcal=%.0f", cookedLogID, est.CaloriesKcal)
			return
		}
		lastErr = err
		log.Printf("[diet-analysis-consumer] groq attempt=%d cooked_log=%s: %v", attempt, cookedLogID, err)
		if attempt < maxDietAnalysisProcessAttempts {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
	}
	msg := "analysis failed"
	if lastErr != nil {
		msg = lastErr.Error()
	}
	_ = nutrition.MarkFailed(ctx, cookedLogID, msg)
}

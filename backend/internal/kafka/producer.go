package kafka

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"kitchenai-backend/pkg/config"

	kafkago "github.com/segmentio/kafka-go"
)

type ShelfLifeEvent struct {
	ItemIDs []string `json:"item_ids"`
	UserID  string   `json:"user_id"`
}

// DietAnalysisEvent triggers async per-meal nutrition enrichment.
type DietAnalysisEvent struct {
	CookedLogID string `json:"cooked_log_id"`
	UserID      string `json:"user_id"`
}

type Producer struct {
	writer           *kafkago.Writer
	shelfLifeTopic   string
	dietAnalysisTopic string
	mu               sync.Mutex // serialize writes so only one produce request runs at a time
}

func NewProducer(cfg *config.Config) *Producer {
	if cfg == nil {
		return nil
	}
	brokers := strings.TrimSpace(cfg.KafkaBrokers)
	if brokers == "" {
		log.Printf("[kafka-producer] disabled (empty KAFKA_BROKERS)")
		return nil
	}
	shelfLifeTopic := strings.TrimSpace(cfg.KafkaTopicShelfLife)
	dietTopic := strings.TrimSpace(cfg.KafkaTopicDietAnalysis)
	if shelfLifeTopic == "" && dietTopic == "" {
		log.Printf("[kafka-producer] disabled (no Kafka topics configured)")
		return nil
	}

	batchTimeout := time.Duration(cfg.KafkaWriterBatchTimeoutSec) * time.Second
	dialer, err := newDialer(cfg)
	if err != nil {
		log.Printf("[kafka-producer] disabled: %v", err)
		return nil
	}
	w := &kafkago.Writer{
		Addr:            kafkago.TCP(strings.Split(brokers, ",")...),
		Transport:       &kafkago.Transport{TLS: dialer.TLS, SASL: dialer.SASLMechanism},
		Balancer:        &kafkago.LeastBytes{},
		BatchSize:       cfg.KafkaWriterBatchSize,
		BatchBytes:      int64(cfg.KafkaWriterBatchBytes),
		BatchTimeout:    batchTimeout,
		Async:           cfg.KafkaWriterAsync,
		MaxAttempts:     cfg.KafkaWriterMaxAttempts,
		WriteBackoffMin: 500 * time.Millisecond,
		WriteBackoffMax: 5 * time.Second,
		ReadTimeout:     30 * time.Second,
		WriteTimeout:    30 * time.Second,
		RequiredAcks:    kafkago.RequireOne,
		Logger:          kafkago.LoggerFunc(func(msg string, a ...interface{}) {}),
		ErrorLogger:     kafkago.LoggerFunc(log.Printf),
	}
	log.Printf("[kafka-producer] initialized shelfLife=%q diet=%q brokers=%s sasl=%v tls=%v (batch=%d/%dB timeout=%s async=%v maxAttempts=%d)",
		shelfLifeTopic, dietTopic, brokers, cfg.KafkaSASLEnabled, cfg.KafkaTLSEnabled, cfg.KafkaWriterBatchSize, cfg.KafkaWriterBatchBytes, batchTimeout, cfg.KafkaWriterAsync, cfg.KafkaWriterMaxAttempts)
	return &Producer{writer: w, shelfLifeTopic: shelfLifeTopic, dietAnalysisTopic: dietTopic}
}

func (p *Producer) publish(topic, key string, value []byte) {
	if p == nil || p.writer == nil || strings.TrimSpace(topic) == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		msg := kafkago.Message{
			Topic: topic,
			Key:   []byte(key),
			Value: value,
		}

		p.mu.Lock()
		err := p.writer.WriteMessages(ctx, msg)
		p.mu.Unlock()
		if err != nil {
			log.Printf("[kafka-producer] publish topic=%s error: %v", topic, err)
			return
		}
	}()
}

func (p *Producer) PublishShelfLifeEvent(event ShelfLifeEvent) {
	if p == nil || p.writer == nil || p.shelfLifeTopic == "" {
		return
	}
	value, err := json.Marshal(event)
	if err != nil {
		log.Printf("[kafka-producer] marshal shelf-life error: %v", err)
		return
	}
	p.publish(p.shelfLifeTopic, event.UserID, value)
	log.Printf("[kafka-producer] published %d shelf-life item(s) for user %s", len(event.ItemIDs), event.UserID)
}

func (p *Producer) PublishDietAnalysisEvent(event DietAnalysisEvent) {
	if p == nil || p.writer == nil || p.dietAnalysisTopic == "" {
		return
	}
	if strings.TrimSpace(event.CookedLogID) == "" || strings.TrimSpace(event.UserID) == "" {
		return
	}
	value, err := json.Marshal(event)
	if err != nil {
		log.Printf("[kafka-producer] marshal diet-analysis error: %v", err)
		return
	}
	p.publish(p.dietAnalysisTopic, event.UserID, value)
	log.Printf("[kafka-producer] published diet-analysis cooked_log=%s user=%s", event.CookedLogID, event.UserID)
}

func (p *Producer) Close() error {
	if p == nil || p.writer == nil {
		return nil
	}
	return p.writer.Close()
}

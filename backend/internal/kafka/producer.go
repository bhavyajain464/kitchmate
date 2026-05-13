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

type Producer struct {
	writer *kafkago.Writer
	topic  string
	mu     sync.Mutex // serialize writes so only one produce request runs at a time
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
	topic := strings.TrimSpace(cfg.KafkaTopicShelfLife)
	if topic == "" {
		log.Printf("[kafka-producer] disabled (empty KAFKA_TOPIC_SHELFLIFE)")
		return nil
	}

	batchTimeout := time.Duration(cfg.KafkaWriterBatchTimeoutSec) * time.Second
	w := &kafkago.Writer{
		Addr:            kafkago.TCP(strings.Split(brokers, ",")...),
		Topic:           topic,
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
	log.Printf("[kafka-producer] initialized topic=%s brokers=%s (batch=%d/%dB timeout=%s async=%v maxAttempts=%d)",
		topic, brokers, cfg.KafkaWriterBatchSize, cfg.KafkaWriterBatchBytes, batchTimeout, cfg.KafkaWriterAsync, cfg.KafkaWriterMaxAttempts)
	return &Producer{writer: w, topic: topic}
}

func (p *Producer) PublishShelfLifeEvent(event ShelfLifeEvent) {
	if p == nil || p.writer == nil {
		return
	}
	go func() {
		value, err := json.Marshal(event)
		if err != nil {
			log.Printf("[kafka-producer] marshal error: %v", err)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		msg := kafkago.Message{
			Key:   []byte(event.UserID),
			Value: value,
		}

		p.mu.Lock()
		err = p.writer.WriteMessages(ctx, msg)
		p.mu.Unlock()
		if err != nil {
			log.Printf("[kafka-producer] publish error: %v", err)
			return
		}

		log.Printf("[kafka-producer] published %d item(s) for user %s", len(event.ItemIDs), event.UserID)
	}()
}

func (p *Producer) Close() error {
	if p == nil || p.writer == nil {
		return nil
	}
	return p.writer.Close()
}

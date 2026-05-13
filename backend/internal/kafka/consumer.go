package kafka

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"

	"github.com/lib/pq"
	kafkago "github.com/segmentio/kafka-go"
)

type itemRow struct {
	ItemID        string
	CanonicalName string
}

func StartShelfLifeConsumer(db *sql.DB, cfg *config.Config) {
	brokers := strings.Split(cfg.KafkaBrokers, ",")
	topic := cfg.KafkaTopicShelfLife
	if len(brokers) == 0 || strings.TrimSpace(brokers[0]) == "" {
		log.Printf("[kafka-consumer] disabled (empty KAFKA_BROKERS)")
		return
	}

	go func() {
		ensureTopicExists(brokers, topic, cfg.KafkaTopicPartitions)

		readBackoffMin := time.Duration(cfg.KafkaConsumerReadBackoffMinMs) * time.Millisecond
		readBackoffMax := time.Duration(cfg.KafkaConsumerReadBackoffMaxMs) * time.Millisecond
		errBackoff := time.Duration(cfg.KafkaConsumerErrorBackoffSec) * time.Second

		reader := kafkago.NewReader(kafkago.ReaderConfig{
			Brokers:               brokers,
			Topic:                 topic,
			GroupID:               "shelflife-group",
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

		log.Printf("[kafka-consumer] listening topic=%s group=shelflife-group (maxBytes=%d maxWait=%s commitEvery=%s readBackoff=%s-%s)",
			topic, cfg.KafkaConsumerMaxBytes,
			time.Duration(cfg.KafkaConsumerMaxWaitSec)*time.Second,
			time.Duration(cfg.KafkaConsumerCommitIntervalSec)*time.Second,
			readBackoffMin, readBackoffMax)
		for {
			msg, err := reader.ReadMessage(context.Background())
			if err != nil {
				log.Printf("[kafka-consumer] read error: %v", err)
				time.Sleep(errBackoff)
				continue
			}
			processMessage(db, cfg, msg.Value)
		}
	}()

	log.Printf("[kafka-consumer] starting in background for topic %s", topic)
}

func ensureTopicExists(brokers []string, topic string, numPartitions int) {
	if numPartitions < 1 {
		numPartitions = 1
	}
	dialer := &kafkago.Dialer{Timeout: 15 * time.Second}

	conn, err := dialer.Dial("tcp", brokers[0])
	if err != nil {
		log.Printf("[kafka-consumer] dial error (topic auto-create may handle it): %v", err)
		return
	}
	defer conn.Close()

	controller, err := conn.Controller()
	if err != nil {
		log.Printf("[kafka-consumer] controller lookup error: %v", err)
		return
	}

	controllerConn, err := dialer.Dial("tcp", controller.Host+":"+strconv.Itoa(controller.Port))
	if err != nil {
		log.Printf("[kafka-consumer] controller dial error: %v", err)
		return
	}
	defer controllerConn.Close()

	err = controllerConn.CreateTopics(kafkago.TopicConfig{
		Topic:             topic,
		NumPartitions:     numPartitions,
		ReplicationFactor: 1,
	})
	if err != nil {
		log.Printf("[kafka-consumer] topic create (may already exist): %v", err)
	} else {
		log.Printf("[kafka-consumer] ensured topic %s exists", topic)
	}
}

func processMessage(db *sql.DB, cfg *config.Config, raw []byte) {
	var event ShelfLifeEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		log.Printf("[kafka-consumer] unmarshal error: %v", err)
		return
	}

	if len(event.ItemIDs) == 0 {
		return
	}

	log.Printf("[kafka-consumer] processing %d item(s) for user %s", len(event.ItemIDs), event.UserID)

	items := fetchItemsNeedingExpiry(db, event.ItemIDs)
	if len(items) == 0 {
		log.Printf("[kafka-consumer] no items need expiry update")
		return
	}

	haveLLMKey := (cfg.LLMProvider == "gemini" && cfg.GeminiAPIKey != "") ||
		(cfg.LLMProvider == "groq" && cfg.GroqAPIKey != "")
	if !haveLLMKey {
		log.Printf("[kafka-consumer] no API key for LLM_PROVIDER=%s, applying defaults", cfg.LLMProvider)
		applyDefaults(db, items)
		return
	}

	batchSize := cfg.KafkaConsumerGeminiBatchSize
	pause := time.Duration(cfg.KafkaConsumerPauseBetweenBatchesMs) * time.Millisecond
	for i := 0; i < len(items); i += batchSize {
		end := i + batchSize
		if end > len(items) {
			end = len(items)
		}
		processBatch(db, cfg, items[i:end])
		if pause > 0 && end < len(items) {
			time.Sleep(pause)
		}
	}
}

// bulkSetEstimatedExpiry applies all expiry updates in a single round-trip.
func bulkSetEstimatedExpiry(dbConn *sql.DB, ids []string, exps []time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	if len(ids) != len(exps) {
		return errors.New("bulkSetEstimatedExpiry: length mismatch")
	}
	_, err := dbConn.Exec(`
		UPDATE inventory AS inv
		SET estimated_expiry = u.exp, updated_at = NOW()
		FROM (
			SELECT * FROM unnest($1::text[], $2::timestamp with time zone[]) AS u(item_id, exp)
		) AS u
		WHERE inv.item_id = u.item_id::uuid
	`, pq.Array(ids), pq.Array(exps))
	return err
}

func fetchItemsNeedingExpiry(db *sql.DB, itemIDs []string) []itemRow {
	if len(itemIDs) == 0 {
		return nil
	}
	rows, err := db.Query(
		`SELECT item_id, canonical_name FROM inventory WHERE item_id = ANY($1) AND estimated_expiry IS NULL`,
		pq.Array(itemIDs),
	)
	if err != nil {
		log.Printf("[kafka-consumer] fetch items error: %v", err)
		return nil
	}
	defer rows.Close()

	var items []itemRow
	for rows.Next() {
		var it itemRow
		if err := rows.Scan(&it.ItemID, &it.CanonicalName); err != nil {
			log.Printf("[kafka-consumer] scan item: %v", err)
			continue
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[kafka-consumer] fetch rows error: %v", err)
	}
	return items
}

func processBatch(db *sql.DB, cfg *config.Config, items []itemRow) {
	names := make([]string, len(items))
	for i, it := range items {
		names[i] = it.CanonicalName
	}

	estimates, err := services.EstimateShelfLifeForConfig(context.Background(), cfg, names)
	if err != nil {
		log.Printf("[kafka-consumer] LLM estimation failed, using defaults: %v", err)
		applyDefaults(db, items)
		return
	}

	estimateMap := make(map[string]int)
	for _, e := range estimates {
		estimateMap[strings.ToLower(e.Name)] = e.ShelfLifeDays
	}

	now := time.Now()
	ids := make([]string, len(items))
	exps := make([]time.Time, len(items))
	for i, it := range items {
		days, ok := estimateMap[strings.ToLower(it.CanonicalName)]
		if !ok || days <= 0 {
			days = DefaultShelfLife(it.CanonicalName)
		}
		ids[i] = it.ItemID
		exps[i] = now.AddDate(0, 0, days)
	}
	if err := bulkSetEstimatedExpiry(db, ids, exps); err != nil {
		log.Printf("[kafka-consumer] bulk update error: %v", err)
		return
	}
	log.Printf("[kafka-consumer] updated %d items in batch", len(ids))
}

func applyDefaults(db *sql.DB, items []itemRow) {
	now := time.Now()
	ids := make([]string, len(items))
	exps := make([]time.Time, len(items))
	for i, it := range items {
		days := DefaultShelfLife(it.CanonicalName)
		ids[i] = it.ItemID
		exps[i] = now.AddDate(0, 0, days)
	}
	if err := bulkSetEstimatedExpiry(db, ids, exps); err != nil {
		log.Printf("[kafka-consumer] bulk default update error: %v", err)
		return
	}
	log.Printf("[kafka-consumer] applied default expiry to %d items", len(items))
}

func DefaultShelfLife(name string) int {
	lower := strings.ToLower(name)

	longLife := []string{"rice", "dal", "lentil", "flour", "atta", "maida", "besan", "rava", "sooji", "poha", "sugar", "salt", "jaggery"}
	for _, kw := range longLife {
		if strings.Contains(lower, kw) {
			return 90
		}
	}

	spices := []string{"turmeric", "haldi", "cumin", "jeera", "coriander", "chili", "mirch", "garam masala", "mustard seed", "pepper", "clove", "cardamom", "cinnamon", "bay leaf"}
	for _, kw := range spices {
		if strings.Contains(lower, kw) {
			return 180
		}
	}

	oils := []string{"oil", "ghee", "butter"}
	for _, kw := range oils {
		if strings.Contains(lower, kw) {
			return 90
		}
	}

	dairy := []string{"milk", "curd", "yogurt", "paneer", "cheese"}
	for _, kw := range dairy {
		if strings.Contains(lower, kw) {
			return 5
		}
	}

	vegs := []string{"tomato", "potato", "onion", "garlic", "ginger"}
	for _, kw := range vegs {
		if strings.Contains(lower, kw) {
			return 10
		}
	}

	if strings.Contains(lower, "bread") || strings.Contains(lower, "pav") {
		return 4
	}
	if strings.Contains(lower, "egg") {
		return 14
	}
	if strings.Contains(lower, "tea") || strings.Contains(lower, "coffee") {
		return 180
	}

	return 30
}

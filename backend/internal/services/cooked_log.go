package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"kitchenai-backend/internal/redis"

	goredis "github.com/redis/go-redis/v9"
)

const (
	CookedHistoryDays   = 15
	cookedCacheKeyPref  = "cooked:history:"
	cookedCacheTTL      = 16 * 24 * time.Hour
)

// CookedLogEntry is one dish cooked on a given day.
type CookedLogEntry struct {
	ID        string  `json:"id"`
	DishName  string  `json:"dish_name"`
	DishID    *string `json:"dish_id,omitempty"`
	CookedOn  string  `json:"cooked_on"` // YYYY-MM-DD
	MealSlot  string  `json:"meal_slot,omitempty"`
	Portions  float64 `json:"portions"`
	Source    string  `json:"source"`
	Notes     string  `json:"notes,omitempty"`
	CreatedAt string  `json:"created_at"`
}

// LogCookedDishInput is the payload for recording a cooked dish.
type LogCookedDishInput struct {
	DishName string
	DishID   string
	CookedOn time.Time
	MealSlot string
	Portions float64
	Source   string
	Notes    string
}

// CookedLogService persists all cooked dishes and caches the last 15 days per user.
type CookedLogService struct {
	db    *sql.DB
	redis *redis.Client
}

func NewCookedLogService(db *sql.DB, r *redis.Client) *CookedLogService {
	return &CookedLogService{db: db, redis: r}
}

func (s *CookedLogService) Log(ctx context.Context, userID string, in LogCookedDishInput) (*CookedLogEntry, error) {
	userID = strings.TrimSpace(userID)
	dishName := strings.TrimSpace(in.DishName)
	if userID == "" || dishName == "" {
		return nil, fmt.Errorf("user_id and dish_name are required")
	}

	cookedOn := in.CookedOn
	if cookedOn.IsZero() {
		cookedOn = time.Now()
	}
	cookedOn = time.Date(cookedOn.Year(), cookedOn.Month(), cookedOn.Day(), 0, 0, 0, 0, time.UTC)

	source := strings.TrimSpace(in.Source)
	if source == "" {
		source = "manual"
	}
	portions := in.Portions
	if portions <= 0 {
		portions = 1
	}
	mealSlot := strings.TrimSpace(in.MealSlot)

	var dishID interface{}
	if strings.TrimSpace(in.DishID) != "" {
		dishID = strings.TrimSpace(in.DishID)
	}

	var id string
	var createdAt time.Time
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO cooked_log (user_id, dish_name, dish_id, cooked_on, meal_slot, portions, source, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at
	`, userID, dishName, dishID, cookedOn, mealSlot, portions, source, strings.TrimSpace(in.Notes)).Scan(&id, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("insert cooked_log: %w", err)
	}

	entry := &CookedLogEntry{
		ID:        id,
		DishName:  dishName,
		CookedOn:  cookedOn.Format("2006-01-02"),
		MealSlot:  mealSlot,
		Portions:  portions,
		Source:    source,
		Notes:     strings.TrimSpace(in.Notes),
		CreatedAt: createdAt.UTC().Format(time.RFC3339),
	}
	if dishID != nil {
		s := dishID.(string)
		entry.DishID = &s
	}

	if err := s.refreshCache(ctx, userID); err != nil {
		log.Printf("[cooked_log] cache refresh failed user=%s: %v", userID, err)
	}
	return entry, nil
}

func (s *CookedLogService) ListLast15Days(ctx context.Context, userID string) ([]CookedLogEntry, bool, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, false, fmt.Errorf("user_id is required")
	}

	if s.redis != nil && s.redis.Enabled() {
		if entries, ok, err := s.getFromCache(ctx, userID); err == nil && ok {
			return entries, true, nil
		} else if err != nil {
			log.Printf("[cooked_log] cache read failed user=%s: %v", userID, err)
		}
	}

	entries, err := s.loadFromDB(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if err := s.setCache(ctx, userID, entries); err != nil {
		log.Printf("[cooked_log] cache write failed user=%s: %v", userID, err)
	}
	return entries, false, nil
}

func (s *CookedLogService) loadFromDB(ctx context.Context, userID string) ([]CookedLogEntry, error) {
	since := time.Now().UTC().AddDate(0, 0, -(CookedHistoryDays - 1))
	since = time.Date(since.Year(), since.Month(), since.Day(), 0, 0, 0, 0, time.UTC)

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, dish_name, dish_id, cooked_on, meal_slot, portions, source, COALESCE(notes, ''), created_at
		FROM cooked_log
		WHERE user_id = $1 AND cooked_on >= $2
		ORDER BY cooked_on DESC, created_at DESC
		LIMIT 200
	`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("query cooked_log: %w", err)
	}
	defer rows.Close()

	var out []CookedLogEntry
	for rows.Next() {
		var e CookedLogEntry
		var cookedOn time.Time
		var createdAt time.Time
		var dishID sql.NullString
		if err := rows.Scan(&e.ID, &e.DishName, &dishID, &cookedOn, &e.MealSlot, &e.Portions, &e.Source, &e.Notes, &createdAt); err != nil {
			return nil, err
		}
		e.CookedOn = cookedOn.Format("2006-01-02")
		e.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		if dishID.Valid {
			e.DishID = &dishID.String
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *CookedLogService) cacheKey(userID string) string {
	return cookedCacheKeyPref + userID
}

func (s *CookedLogService) getFromCache(ctx context.Context, userID string) ([]CookedLogEntry, bool, error) {
	rdb := s.redis.Raw()
	raw, err := rdb.Get(ctx, s.cacheKey(userID)).Result()
	if err == goredis.Nil {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var entries []CookedLogEntry
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil, false, err
	}
	return entries, true, nil
}

func (s *CookedLogService) setCache(ctx context.Context, userID string, entries []CookedLogEntry) error {
	if s.redis == nil || !s.redis.Enabled() {
		return nil
	}
	if entries == nil {
		entries = []CookedLogEntry{}
	}
	b, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	return s.redis.Raw().Set(ctx, s.cacheKey(userID), b, cookedCacheTTL).Err()
}

func (s *CookedLogService) refreshCache(ctx context.Context, userID string) error {
	entries, err := s.loadFromDB(ctx, userID)
	if err != nil {
		return err
	}
	return s.setCache(ctx, userID, entries)
}

// LogDishName is a convenience helper for hooks (cook send, meal suggestion, etc.).
func (s *CookedLogService) LogDishName(ctx context.Context, userID, dishName, source string) {
	if s == nil {
		return
	}
	_, err := s.Log(ctx, userID, LogCookedDishInput{
		DishName: dishName,
		Source:   source,
	})
	if err != nil {
		log.Printf("[cooked_log] log dish %q source=%s: %v", dishName, source, err)
	}
}

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

// Non-eaten sources are kept in cooked_log for auditing but excluded from "What you ate".
var cookedLogNonEatenSources = map[string]bool{
	CookedSourceCookSent: true,
	CookedSourceMealSent: true,
	"ai-suggested":       true,
	CookedSourceMealSuggested: true,
}

// IsEatenLogSource reports whether a cooked_log row belongs in meal / diet history.
func IsEatenLogSource(source string) bool {
	return !cookedLogNonEatenSources[strings.ToLower(strings.TrimSpace(source))]
}

func filterEatenEntries(entries []CookedLogEntry) []CookedLogEntry {
	if len(entries) == 0 {
		return entries
	}
	out := make([]CookedLogEntry, 0, len(entries))
	for _, e := range entries {
		if IsEatenLogSource(e.Source) {
			out = append(out, e)
		}
	}
	return out
}

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
	db            *sql.DB
	redis         *redis.Client
	dietPublisher DietAnalysisPublisher
	nutrition     *MealNutritionService
}

func NewCookedLogService(db *sql.DB, r *redis.Client) *CookedLogService {
	return &CookedLogService{db: db, redis: r, nutrition: NewMealNutritionService(db)}
}

// SetDietAnalysisPublisher wires async per-meal nutrition triggers (optional).
func (s *CookedLogService) SetDietAnalysisPublisher(p DietAnalysisPublisher) {
	if s == nil {
		return
	}
	s.dietPublisher = p
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
	s.enqueueDietAnalysis(ctx, entry.ID, userID, entry.Source)
	return entry, nil
}

func (s *CookedLogService) enqueueDietAnalysis(ctx context.Context, cookedLogID, userID, source string) {
	if s == nil || !IsEatenLogSource(source) {
		return
	}
	if s.nutrition != nil {
		if err := s.nutrition.EnqueuePending(ctx, cookedLogID, userID); err != nil {
			log.Printf("[cooked_log] nutrition enqueue cooked_log=%s: %v", cookedLogID, err)
		}
	}
	if s.dietPublisher != nil {
		s.dietPublisher.PublishDietAnalysis(cookedLogID, userID)
	}
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

// ListEatenLast15Days returns only dishes the user actually ate (excludes cook WhatsApp drafts).
func (s *CookedLogService) ListEatenLast15Days(ctx context.Context, userID string) ([]CookedLogEntry, bool, error) {
	entries, fromCache, err := s.ListLast15Days(ctx, userID)
	if err != nil {
		return nil, fromCache, err
	}
	return filterEatenEntries(entries), fromCache, nil
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

const (
	CookedSourceCookSent      = "cook-sent"
	CookedSourceMealSent      = "meal-sent"
	CookedSourceMealSuggested = "meal-suggested"
)

// ListRecentEatenDays returns days since each dish was last eaten (excludes drafts / suggestions).
func (s *CookedLogService) ListRecentEatenDays(ctx context.Context, userID string, withinDays int) (map[string]int, error) {
	entries, _, err := s.ListEatenLast15Days(ctx, userID)
	if err != nil {
		return nil, err
	}
	if withinDays <= 0 {
		withinDays = CookedHistoryDays
	}
	now := time.Now().UTC()
	out := map[string]int{}
	for _, e := range entries {
		cookedOn, err := time.Parse("2006-01-02", e.CookedOn)
		if err != nil {
			continue
		}
		days := int(now.Sub(cookedOn).Hours() / 24)
		if days < 0 {
			days = 0
		}
		if days > withinDays {
			continue
		}
		key := NormalizeDishName(e.DishName)
		if prev, ok := out[key]; !ok || days < prev {
			out[key] = days
		}
	}
	return out, nil
}

// ListRecentMealSuggestionDays returns days since each dish was last suggested (AI smart meals).
func (s *CookedLogService) ListRecentMealSuggestionDays(ctx context.Context, userID string, withinDays int) (map[string]int, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	if withinDays <= 0 {
		withinDays = 14
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT dish_name, MAX(created_at) AS last_at
		FROM cooked_log
		WHERE user_id = $1 AND source = $2
		  AND created_at >= NOW() - ($3::int * INTERVAL '1 day')
		GROUP BY dish_name
	`, userID, CookedSourceMealSuggested, withinDays)
	if err != nil {
		return nil, fmt.Errorf("query meal suggestions: %w", err)
	}
	defer rows.Close()

	now := time.Now()
	out := map[string]int{}
	for rows.Next() {
		var name string
		var lastAt time.Time
		if err := rows.Scan(&name, &lastAt); err != nil {
			return nil, err
		}
		days := int(now.Sub(lastAt).Hours() / 24)
		if days < 0 {
			days = 0
		}
		out[NormalizeDishName(name)] = days
	}
	return out, rows.Err()
}

// LogCookMessage records an outbound WhatsApp draft to the cook (excluded from "What you ate").
func (s *CookedLogService) LogCookMessage(ctx context.Context, userID, source, dishName, body string) {
	if s == nil {
		return
	}
	title := strings.TrimSpace(dishName)
	if title == "" && strings.TrimSpace(body) != "" {
		title = strings.TrimSpace(strings.Split(body, "\n")[0])
	}
	if title == "" {
		title = "Message to cook"
	}
	if len(title) > 120 {
		title = title[:117] + "..."
	}
	_, err := s.Log(ctx, userID, LogCookedDishInput{
		DishName: title,
		Source:   source,
		Notes:    strings.TrimSpace(body),
	})
	if err != nil {
		log.Printf("[cooked_log] log cook message source=%s: %v", source, err)
	}
}

// ListRecentCookMessages returns the latest outbound cook WhatsApp drafts (not eaten meals).
func (s *CookedLogService) ListRecentCookMessages(ctx context.Context, userID string, limit int) ([]CookedLogEntry, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	if limit <= 0 {
		limit = 5
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, dish_name, dish_id, cooked_on, meal_slot, portions, source, COALESCE(notes, ''), created_at
		FROM cooked_log
		WHERE user_id = $1 AND source IN ($2, $3)
		ORDER BY created_at DESC
		LIMIT $4
	`, userID, CookedSourceCookSent, CookedSourceMealSent, limit)
	if err != nil {
		return nil, fmt.Errorf("query cook messages: %w", err)
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

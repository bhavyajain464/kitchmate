package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	NutritionStatusPending    = "pending"
	NutritionStatusProcessing = "processing"
	NutritionStatusCompleted  = "completed"
	NutritionStatusFailed     = "failed"

	maxDietAnalysisAttempts = 3
)

// MealMicronutrientAmount is a numeric micronutrient with an explicit unit.
type MealMicronutrientAmount struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
	Unit   string  `json:"unit"`
}

// MealNutritionRecord is stored per cooked_log row.
type MealNutritionRecord struct {
	CookedLogID    string
	UserID         string
	Status         string
	AttemptCount   int
	LastError      string
	Model          string
	CaloriesKcal   float64
	ProteinG       float64
	CarbsG         float64
	FatG           float64
	FiberG         float64
	SugarG         float64
	SodiumMg       float64
	Micronutrients []MealMicronutrientAmount
	AnalyzedAt     *time.Time
	DishName       string
	MealSlot       string
	CookedOn       string
}

// DietAnalysisPublisher publishes Kafka events for async meal nutrition.
type DietAnalysisPublisher interface {
	PublishDietAnalysis(cookedLogID, userID string)
}

// MealNutritionService persists and loads per-meal nutrition rows.
type MealNutritionService struct {
	db *sql.DB
}

func NewMealNutritionService(db *sql.DB) *MealNutritionService {
	return &MealNutritionService{db: db}
}

// EnsureMealNutritionSchema creates the table if missing (idempotent startup helper).
func EnsureMealNutritionSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS cooked_meal_nutrition (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			cooked_log_id UUID NOT NULL UNIQUE REFERENCES cooked_log(id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			attempt_count INT NOT NULL DEFAULT 0,
			last_error TEXT,
			model TEXT,
			calories_kcal DOUBLE PRECISION,
			protein_g DOUBLE PRECISION,
			carbs_g DOUBLE PRECISION,
			fat_g DOUBLE PRECISION,
			fiber_g DOUBLE PRECISION,
			sugar_g DOUBLE PRECISION,
			sodium_mg DOUBLE PRECISION,
			micronutrients JSONB NOT NULL DEFAULT '[]'::jsonb,
			analyzed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_cooked_meal_nutrition_user_status
			ON cooked_meal_nutrition (user_id, status);
	`)
	return err
}

// EnqueuePending inserts a pending nutrition row for a newly logged meal (idempotent).
func (s *MealNutritionService) EnqueuePending(ctx context.Context, cookedLogID, userID string) error {
	if s == nil || s.db == nil {
		return nil
	}
	cookedLogID = strings.TrimSpace(cookedLogID)
	userID = strings.TrimSpace(userID)
	if cookedLogID == "" || userID == "" {
		return fmt.Errorf("cooked_log_id and user_id required")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cooked_meal_nutrition (cooked_log_id, user_id, status)
		VALUES ($1, $2, $3)
		ON CONFLICT (cooked_log_id) DO NOTHING
	`, cookedLogID, userID, NutritionStatusPending)
	return err
}

// MarkProcessing claims a row for analysis. Returns false if already completed or missing.
func (s *MealNutritionService) MarkProcessing(ctx context.Context, cookedLogID string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE cooked_meal_nutrition
		SET status = $2,
		    attempt_count = attempt_count + 1,
		    last_error = NULL,
		    updated_at = NOW()
		WHERE cooked_log_id = $1
		  AND status IN ($3, $4, $5)
		  AND attempt_count < $6
	`, cookedLogID, NutritionStatusProcessing, NutritionStatusPending, NutritionStatusFailed, NutritionStatusProcessing, maxDietAnalysisAttempts)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// SaveCompleted stores successful per-meal nutrition totals (already portion-adjusted).
func (s *MealNutritionService) SaveCompleted(ctx context.Context, cookedLogID, model string, macros DietMacroTotals, micros []MealMicronutrientAmount) error {
	microJSON, err := json.Marshal(micros)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE cooked_meal_nutrition
		SET status = $2,
		    model = $3,
		    calories_kcal = $4,
		    protein_g = $5,
		    carbs_g = $6,
		    fat_g = $7,
		    fiber_g = $8,
		    sugar_g = $9,
		    sodium_mg = $10,
		    micronutrients = $11::jsonb,
		    last_error = NULL,
		    analyzed_at = NOW(),
		    updated_at = NOW()
		WHERE cooked_log_id = $1
	`, cookedLogID, NutritionStatusCompleted, strings.TrimSpace(model),
		macros.CaloriesKcal, macros.ProteinG, macros.CarbsG, macros.FatG,
		macros.FiberG, macros.SugarG, macros.SodiumMg, string(microJSON))
	return err
}

// MarkFailed records a failure after consumer retries are exhausted.
func (s *MealNutritionService) MarkFailed(ctx context.Context, cookedLogID, errMsg string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE cooked_meal_nutrition
		SET status = $2,
		    last_error = $3,
		    updated_at = NOW()
		WHERE cooked_log_id = $1
	`, cookedLogID, NutritionStatusFailed, truncate(errMsg, 500))
	return err
}

// GetByCookedLogID returns nutrition for one meal, if any.
func (s *MealNutritionService) GetByCookedLogID(ctx context.Context, cookedLogID string) (*MealNutritionRecord, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT c.id::text, c.user_id::text, COALESCE(n.status, ''), COALESCE(n.attempt_count, 0), COALESCE(n.last_error, ''),
		       COALESCE(n.model, ''), COALESCE(n.calories_kcal, 0), COALESCE(n.protein_g, 0),
		       COALESCE(n.carbs_g, 0), COALESCE(n.fat_g, 0), COALESCE(n.fiber_g, 0),
		       COALESCE(n.sugar_g, 0), COALESCE(n.sodium_mg, 0), COALESCE(n.micronutrients, '[]'::jsonb), n.analyzed_at,
		       c.dish_name, COALESCE(c.meal_slot, ''), c.cooked_on, c.source
		FROM cooked_log c
		LEFT JOIN cooked_meal_nutrition n ON n.cooked_log_id = c.id
		WHERE c.id = $1
	`, cookedLogID)
	rec, _, err := scanMealNutritionRow(row)
	return rec, err
}

// ListForDateRange returns nutrition rows joined to cooked_log for a date range.
func (s *MealNutritionService) ListForDateRange(ctx context.Context, userID, startISO, endISO string) ([]MealNutritionRecord, error) {
	userID = strings.TrimSpace(userID)
	startISO = strings.TrimSpace(startISO)
	endISO = strings.TrimSpace(endISO)
	if userID == "" || startISO == "" || endISO == "" {
		return nil, fmt.Errorf("user_id and date range required")
	}
	startDay, err := time.Parse("2006-01-02", startISO)
	if err != nil {
		return nil, fmt.Errorf("invalid start date")
	}
	endDay, err := time.Parse("2006-01-02", endISO)
	if err != nil {
		return nil, fmt.Errorf("invalid end date")
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id::text, c.user_id::text, COALESCE(n.status, ''), COALESCE(n.attempt_count, 0), COALESCE(n.last_error, ''),
		       COALESCE(n.model, ''), COALESCE(n.calories_kcal, 0), COALESCE(n.protein_g, 0),
		       COALESCE(n.carbs_g, 0), COALESCE(n.fat_g, 0), COALESCE(n.fiber_g, 0),
		       COALESCE(n.sugar_g, 0), COALESCE(n.sodium_mg, 0), COALESCE(n.micronutrients, '[]'::jsonb), n.analyzed_at,
		       c.dish_name, COALESCE(c.meal_slot, ''), c.cooked_on, c.source
		FROM cooked_log c
		LEFT JOIN cooked_meal_nutrition n ON n.cooked_log_id = c.id
		WHERE c.user_id = $1 AND c.cooked_on >= $2 AND c.cooked_on <= $3
		ORDER BY c.cooked_on ASC, c.created_at ASC
	`, userID, startDay, endDay)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MealNutritionRecord
	for rows.Next() {
		rec, source, err := scanMealNutritionRow(rows)
		if err != nil {
			return nil, err
		}
		if rec == nil || !IsEatenLogSource(source) {
			continue
		}
		out = append(out, *rec)
	}
	return out, rows.Err()
}

type mealNutritionScanner interface {
	Scan(dest ...any) error
}

func scanMealNutritionRow(row mealNutritionScanner) (*MealNutritionRecord, string, error) {
	var rec MealNutritionRecord
	var micros rawJSON
	var analyzedAt sql.NullTime
	var cookedOn time.Time
	var source string
	err := row.Scan(
		&rec.CookedLogID, &rec.UserID, &rec.Status, &rec.AttemptCount, &rec.LastError,
		&rec.Model, &rec.CaloriesKcal, &rec.ProteinG, &rec.CarbsG, &rec.FatG,
		&rec.FiberG, &rec.SugarG, &rec.SodiumMg, &micros, &analyzedAt,
		&rec.DishName, &rec.MealSlot, &cookedOn, &source,
	)
	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	rec.CookedOn = cookedOn.Format("2006-01-02")
	if analyzedAt.Valid {
		t := analyzedAt.Time.UTC()
		rec.AnalyzedAt = &t
	}
	if len(micros) > 0 {
		_ = json.Unmarshal(micros, &rec.Micronutrients)
	}
	return &rec, source, nil
}

type rawJSON []byte

func (b *rawJSON) Scan(src any) error {
	if src == nil {
		*b = []byte("[]")
		return nil
	}
	switch v := src.(type) {
	case []byte:
		*b = append((*b)[0:0], v...)
	case string:
		*b = []byte(v)
	default:
		return fmt.Errorf("unsupported micronutrients type %T", src)
	}
	return nil
}

// LoadCookedLogForAnalysis loads the cooked_log row for consumer enrichment.
func (s *MealNutritionService) LoadCookedLogForAnalysis(ctx context.Context, cookedLogID string) (*CookedLogEntry, string, error) {
	var e CookedLogEntry
	var userID string
	var cookedOn time.Time
	var createdAt time.Time
	var dishID sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text, user_id::text, dish_name, dish_id, cooked_on, meal_slot, portions, source, COALESCE(notes, ''), created_at
		FROM cooked_log WHERE id = $1
	`, cookedLogID).Scan(&e.ID, &userID, &e.DishName, &dishID, &cookedOn, &e.MealSlot, &e.Portions, &e.Source, &e.Notes, &createdAt)
	if err != nil {
		return nil, "", err
	}
	e.CookedOn = cookedOn.Format("2006-01-02")
	e.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	if dishID.Valid {
		e.DishID = &dishID.String
	}
	return &e, userID, nil
}

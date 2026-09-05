-- Per-meal nutrition analysis (async Groq enrichment keyed by cooked_log.id).

CREATE TABLE IF NOT EXISTS cooked_meal_nutrition (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cooked_meal_nutrition_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_cooked_meal_nutrition_user_status
    ON cooked_meal_nutrition (user_id, status);

CREATE INDEX IF NOT EXISTS idx_cooked_meal_nutrition_user_cooked
    ON cooked_meal_nutrition (user_id, cooked_log_id);

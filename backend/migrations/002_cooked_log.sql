-- Cooked dish history (all rows kept in Postgres; API caches last 15 days in Redis).

CREATE TABLE IF NOT EXISTS cooked_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    dish_name TEXT NOT NULL,
    dish_id UUID,
    cooked_on DATE NOT NULL DEFAULT CURRENT_DATE,
    meal_slot VARCHAR(20) DEFAULT '',
    portions DOUBLE PRECISION DEFAULT 1,
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cooked_log_user_cooked_on ON cooked_log (user_id, cooked_on DESC);
CREATE INDEX IF NOT EXISTS idx_cooked_log_user_created ON cooked_log (user_id, created_at DESC);

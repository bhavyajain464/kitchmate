-- Run once against your Postgres (e.g. psql or CI) — not executed by the API server.
-- Idempotent: safe to re-run.

-- Profile / onboarding / memory (used by profile handlers)
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS household_size INTEGER DEFAULT 2;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS allergies TEXT[] DEFAULT '{}';
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS spice_level TEXT DEFAULT 'medium';
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS cooking_skill TEXT DEFAULT 'intermediate';
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN DEFAULT FALSE;

ALTER TABLE cook_profile ADD COLUMN IF NOT EXISTS cook_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS user_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Shopping list
CREATE TABLE IF NOT EXISTS shopping_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    qty DOUBLE PRECISION DEFAULT 1,
    unit TEXT DEFAULT 'pcs',
    bought BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    bought_at TIMESTAMPTZ
);

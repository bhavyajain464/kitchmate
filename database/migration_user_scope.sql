-- Migration: Add user_id scoping to inventory, cook_profile, and shopping_list

-- 1. Add user_id column to inventory (nullable first for existing rows)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;

-- 2. Add user_id column to cook_profile
ALTER TABLE cook_profile ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;

-- 3. Add user_id column to shopping_list
ALTER TABLE shopping_list ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;

-- 4. Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_cook_profile_user ON cook_profile(user_id);
CREATE INDEX IF NOT EXISTS idx_shopping_list_user ON shopping_list(user_id);

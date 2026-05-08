-- Kitchen OS Database Schema
-- PostgreSQL schema for AI-powered kitchen operating system

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table: For Google OAuth authentication
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    picture_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Inventory Table: Tracks all items in the pantry/fridge
CREATE TABLE IF NOT EXISTS inventory (
    item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_name VARCHAR(255) NOT NULL,
    qty DECIMAL(10, 2) NOT NULL DEFAULT 0,
    unit VARCHAR(50) NOT NULL DEFAULT 'pieces',
    estimated_expiry DATE,
    is_manual BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Add index for expiry monitoring
    CONSTRAINT positive_qty CHECK (qty >= 0)
);

-- User Preferences Table: Stores user's dietary preferences and dislikes
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    dislikes TEXT[] DEFAULT '{}', -- Array of disliked food items
    dietary_tags TEXT[] DEFAULT '{}', -- e.g., 'vegetarian', 'vegan', 'gluten-free'
    fav_cuisines TEXT[] DEFAULT '{}', -- e.g., 'indian', 'italian', 'chinese'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Cook Profile Table: Stores cook's skills and language preferences
CREATE TABLE IF NOT EXISTS cook_profile (
    cook_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dishes_known TEXT[] DEFAULT '{}', -- Array of dishes the cook knows how to prepare
    preferred_lang VARCHAR(10) DEFAULT 'en', -- Language code: 'en', 'hi', 'kn'
    phone_number VARCHAR(20), -- For WhatsApp communication
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Meal Suggestions Table: Stores AI-generated meal suggestions
CREATE TABLE IF NOT EXISTS meal_suggestions (
    suggestion_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meal_name VARCHAR(255) NOT NULL,
    ingredients JSONB NOT NULL, -- Array of required ingredients with quantities
    cook_id UUID REFERENCES cook_profile(cook_id),
    estimated_cooking_time INT, -- in minutes
    priority_score DECIMAL(5, 2), -- Based on expiry, preferences, etc.
    suggested_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'sent'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Shopping List Table: Generated smart shopping lists
CREATE TABLE IF NOT EXISTS shopping_list (
    list_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    items JSONB NOT NULL, -- Array of items to buy
    generated_date DATE NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Auth Sessions Table: For user authentication sessions
CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'google',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    client_ip VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_inventory_expiry ON inventory(estimated_expiry);
CREATE INDEX idx_inventory_name ON inventory(canonical_name);
CREATE INDEX idx_meal_suggestions_date ON meal_suggestions(suggested_date);
CREATE INDEX idx_meal_suggestions_status ON meal_suggestions(status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic updated_at
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_prefs_updated_at BEFORE UPDATE ON user_prefs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cook_profile_updated_at BEFORE UPDATE ON cook_profile
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data for testing
INSERT INTO user_prefs (dislikes, dietary_tags, fav_cuisines) VALUES
    ('{"brinjal", "bitter gourd"}', '{"vegetarian"}', '{"indian", "italian"}')
ON CONFLICT DO NOTHING;

INSERT INTO cook_profile (dishes_known, preferred_lang, phone_number) VALUES
    ('{"paneer butter masala", "dal tadka", "roti", "rice"}', 'hi', '+919876543210')
ON CONFLICT DO NOTHING;

INSERT INTO inventory (canonical_name, qty, unit, estimated_expiry, is_manual) VALUES
    ('Milk', 1.5, 'liters', CURRENT_DATE + INTERVAL '3 days', false),
    ('Tomato', 5, 'pieces', CURRENT_DATE + INTERVAL '5 days', false),
    ('Onion', 10, 'pieces', CURRENT_DATE + INTERVAL '10 days', false),
    ('Paneer', 200, 'grams', CURRENT_DATE + INTERVAL '2 days', false),
    ('Rice', 2, 'kg', CURRENT_DATE + INTERVAL '30 days', true)
ON CONFLICT DO NOTHING;
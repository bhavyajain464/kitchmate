package models

import (
	"database/sql"
	"time"
)

// Inventory represents an item in the pantry/fridge
type Inventory struct {
	ItemID          string     `json:"item_id"`
	CanonicalName   string     `json:"canonical_name"`
	Qty             float64    `json:"qty"`
	Unit            string     `json:"unit"`
	EstimatedExpiry *time.Time `json:"estimated_expiry,omitempty"`
	IsManual        bool       `json:"is_manual"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// InventoryRequest represents the payload for creating/updating inventory
type InventoryRequest struct {
	CanonicalName   string  `json:"canonical_name" validate:"required"`
	Qty             float64 `json:"qty" validate:"required,gt=0"`
	Unit            string  `json:"unit" validate:"required"`
	EstimatedExpiry string  `json:"estimated_expiry,omitempty"`
	IsManual        bool    `json:"is_manual"`
}

// User represents a user account for authentication
type User struct {
	UserID     string    `json:"user_id"`
	GoogleID   string    `json:"google_id"`
	Email      string    `json:"email"`
	Name       string    `json:"name"`
	PictureURL string    `json:"picture_url,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// UserPreferences represents user's dietary preferences and dislikes
type UserPreferences struct {
	UserID      string    `json:"user_id"`
	Dislikes    []string  `json:"dislikes"`
	DietaryTags []string  `json:"dietary_tags"`
	FavCuisines []string  `json:"fav_cuisines"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// UserPreferencesRequest represents the payload for updating user preferences
type UserPreferencesRequest struct {
	Dislikes    []string `json:"dislikes"`
	DietaryTags []string `json:"dietary_tags"`
	FavCuisines []string `json:"fav_cuisines"`
}

// CookProfile represents cook's skills and language preferences
type CookProfile struct {
	CookID        string    `json:"cook_id"`
	DishesKnown   []string  `json:"dishes_known"`
	PreferredLang string    `json:"preferred_lang"`
	PhoneNumber   string    `json:"phone_number,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// CookProfileRequest represents the payload for updating cook profile
type CookProfileRequest struct {
	DishesKnown   []string `json:"dishes_known"`
	PreferredLang string   `json:"preferred_lang"`
	PhoneNumber   string   `json:"phone_number,omitempty"`
}

// ExpiringItem represents an inventory item that is near expiry
type ExpiringItem struct {
	ItemID          string    `json:"item_id"`
	CanonicalName   string    `json:"canonical_name"`
	Qty             float64   `json:"qty"`
	Unit            string    `json:"unit"`
	EstimatedExpiry time.Time `json:"estimated_expiry"`
	DaysUntilExpiry int       `json:"days_until_expiry"`
}

// NullString handles nullable strings from database
func NullString(s sql.NullString) *string {
	if s.Valid {
		return &s.String
	}
	return nil
}

// Ingredient represents an ingredient with quantity
type Ingredient struct {
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
}

// MealSuggestion represents a meal suggestion
type MealSuggestion struct {
	MealID      string       `json:"meal_id"`
	MealName    string       `json:"meal_name"`
	Ingredients []Ingredient `json:"ingredients"`
	CookID      string       `json:"cook_id"`
	CookingTime int          `json:"cooking_time"`
	Priority    float64      `json:"priority"`
	Date        time.Time    `json:"date"`
	Status      string       `json:"status"`
}

// ShoppingListItem represents an item in shopping list
type ShoppingListItem struct {
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Priority int     `json:"priority"`
}

// NullTime handles nullable times from database
func NullTime(t sql.NullTime) *time.Time {
	if t.Valid {
		return &t.Time
	}
	return nil
}

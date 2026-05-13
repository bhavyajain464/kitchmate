package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"kitchenai-backend/internal/models"
)

// ProcurementService handles shopping list generation and low-stock detection
type ProcurementService struct {
	db *sql.DB
}

// NewProcurementService creates a new procurement service
func NewProcurementService(db *sql.DB) *ProcurementService {
	return &ProcurementService{db: db}
}

// LowStockThreshold defines minimum quantities for common items
var LowStockThreshold = map[string]struct {
	MinQty  float64
	Unit    string
	Default float64 // Default quantity to buy when restocking
}{
	"milk":    {MinQty: 0.5, Unit: "liters", Default: 2.0},
	"tomato":  {MinQty: 3, Unit: "pieces", Default: 10.0},
	"onion":   {MinQty: 2, Unit: "pieces", Default: 5.0},
	"potato":  {MinQty: 3, Unit: "pieces", Default: 10.0},
	"rice":    {MinQty: 0.5, Unit: "kg", Default: 5.0},
	"wheat":   {MinQty: 0.5, Unit: "kg", Default: 5.0},
	"oil":     {MinQty: 0.2, Unit: "liters", Default: 1.0},
	"sugar":   {MinQty: 0.2, Unit: "kg", Default: 2.0},
	"salt":    {MinQty: 0.1, Unit: "kg", Default: 1.0},
	"paneer":  {MinQty: 100, Unit: "grams", Default: 500.0},
	"curd":    {MinQty: 200, Unit: "grams", Default: 500.0},
	"butter":  {MinQty: 50, Unit: "grams", Default: 200.0},
	"bread":   {MinQty: 2, Unit: "slices", Default: 10.0},
	"eggs":    {MinQty: 2, Unit: "pieces", Default: 12.0},
	"flour":   {MinQty: 0.5, Unit: "kg", Default: 5.0},
	"lentils": {MinQty: 0.2, Unit: "kg", Default: 2.0},
	"spices":  {MinQty: 10, Unit: "grams", Default: 100.0},
}

// ShoppingListRequest represents the request for generating a shopping list
type ShoppingListRequest struct {
	IncludeLowStock bool `json:"include_low_stock"`
	IncludeExpiring bool `json:"include_expiring"`
	MaxItems        int  `json:"max_items"`
}

// ShoppingListResponse represents the response with shopping list items
type ShoppingListResponse struct {
	Items         []models.ShoppingListItem `json:"items"`
	TotalItems    int                       `json:"total_items"`
	GeneratedAt   time.Time                 `json:"generated_at"`
	LowStockCount int                       `json:"low_stock_count"`
	ExpiringCount int                       `json:"expiring_count"`
}

// LowStockItem represents an item that is running low
type LowStockItem struct {
	Name           string  `json:"name"`
	CurrentQty     float64 `json:"current_qty"`
	Unit           string  `json:"unit"`
	MinQty         float64 `json:"min_qty"`
	RecommendedQty float64 `json:"recommended_qty"`
	Priority       int     `json:"priority"` // 1=critical, 2=low, 3=ok
}

// GetLowStockItems returns items that are below their minimum threshold
func (s *ProcurementService) GetLowStockItems() ([]LowStockItem, error) {
	query := `
		SELECT canonical_name, qty, unit 
		FROM inventory 
		WHERE estimated_expiry > CURRENT_DATE OR estimated_expiry IS NULL
		ORDER BY canonical_name
	`

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query inventory: %v", err)
	}
	defer rows.Close()

	var lowStockItems []LowStockItem

	for rows.Next() {
		var name string
		var qty float64
		var unit string

		if err := rows.Scan(&name, &qty, &unit); err != nil {
			log.Printf("Error scanning inventory row: %v", err)
			continue
		}

		// Normalize name for threshold lookup
		normalizedName := normalizeItemName(name)

		if threshold, exists := LowStockThreshold[normalizedName]; exists {
			if qty <= threshold.MinQty {
				priority := 1 // critical
				if qty > threshold.MinQty/2 {
					priority = 2 // low but not critical
				}

				lowStockItems = append(lowStockItems, LowStockItem{
					Name:           name,
					CurrentQty:     qty,
					Unit:           unit,
					MinQty:         threshold.MinQty,
					RecommendedQty: threshold.Default,
					Priority:       priority,
				})
			}
		} else {
			// Default threshold for unknown items
			if qty <= 1 {
				lowStockItems = append(lowStockItems, LowStockItem{
					Name:           name,
					CurrentQty:     qty,
					Unit:           unit,
					MinQty:         1,
					RecommendedQty: 5,
					Priority:       2,
				})
			}
		}
	}

	return lowStockItems, nil
}

// GenerateShoppingList creates a smart shopping list based on low stock and expiring items
func (s *ProcurementService) GenerateShoppingList(req ShoppingListRequest) (*ShoppingListResponse, error) {
	var items []models.ShoppingListItem

	// Get low stock items
	if req.IncludeLowStock {
		lowStockItems, err := s.GetLowStockItems()
		if err != nil {
			log.Printf("Warning: failed to get low stock items: %v", err)
		} else {
			for _, lowItem := range lowStockItems {
				// Calculate quantity to buy
				qtyToBuy := lowItem.RecommendedQty
				if lowItem.CurrentQty > 0 {
					qtyToBuy = lowItem.RecommendedQty - lowItem.CurrentQty
					if qtyToBuy < 0 {
						qtyToBuy = 0
					}
				}

				if qtyToBuy > 0 {
					items = append(items, models.ShoppingListItem{
						Name:     lowItem.Name,
						Quantity: qtyToBuy,
						Unit:     lowItem.Unit,
						Priority: lowItem.Priority,
					})
				}
			}
		}
	}

	// Get expiring items that need replacement (optional)
	if req.IncludeExpiring {
		expiringItems, err := s.getExpiringItemsForReplacement(3) // items expiring in 3 days
		if err != nil {
			log.Printf("Warning: failed to get expiring items: %v", err)
		} else {
			for _, expItem := range expiringItems {
				// Add replacement for expiring items
				normalizedName := normalizeItemName(expItem.CanonicalName)
				if threshold, exists := LowStockThreshold[normalizedName]; exists {
					items = append(items, models.ShoppingListItem{
						Name:     expItem.CanonicalName,
						Quantity: threshold.Default,
						Unit:     expItem.Unit,
						Priority: 1, // High priority since item is expiring
					})
				}
			}
		}
	}

	// Limit items if requested
	if req.MaxItems > 0 && len(items) > req.MaxItems {
		items = items[:req.MaxItems]
	}

	// Save shopping list to database
	if err := s.saveShoppingList(items); err != nil {
		log.Printf("Warning: failed to save shopping list: %v", err)
	}

	return &ShoppingListResponse{
		Items:         items,
		TotalItems:    len(items),
		GeneratedAt:   time.Now(),
		LowStockCount: countLowStockItems(items),
		ExpiringCount: countExpiringItems(items),
	}, nil
}

// getExpiringItemsForReplacement returns items expiring within specified days
func (s *ProcurementService) getExpiringItemsForReplacement(days int) ([]models.ExpiringItem, error) {
	query := `
		SELECT item_id, canonical_name, qty, unit, estimated_expiry,
		       DATE_PART('day', estimated_expiry - CURRENT_DATE)::int as days_until_expiry
		FROM inventory
		WHERE estimated_expiry IS NOT NULL 
		  AND estimated_expiry <= CURRENT_DATE + INTERVAL '1 day' * $1
		ORDER BY estimated_expiry
	`

	rows, err := s.db.Query(query, days)
	if err != nil {
		return nil, fmt.Errorf("failed to query expiring items: %v", err)
	}
	defer rows.Close()

	var expiringItems []models.ExpiringItem

	for rows.Next() {
		var item models.ExpiringItem
		if err := rows.Scan(
			&item.ItemID,
			&item.CanonicalName,
			&item.Qty,
			&item.Unit,
			&item.EstimatedExpiry,
			&item.DaysUntilExpiry,
		); err != nil {
			log.Printf("Error scanning expiring item: %v", err)
			continue
		}
		expiringItems = append(expiringItems, item)
	}

	return expiringItems, nil
}

// saveShoppingList saves the shopping list to the database
func (s *ProcurementService) saveShoppingList(items []models.ShoppingListItem) error {
	if len(items) == 0 {
		return nil
	}

	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return fmt.Errorf("failed to marshal items: %v", err)
	}

	query := `
		INSERT INTO shopping_list (items, generated_date, completed)
		VALUES ($1, $2, $3)
	`

	_, err = s.db.Exec(query, itemsJSON, time.Now().Format("2006-01-02"), false)
	if err != nil {
		return fmt.Errorf("failed to insert shopping list: %v", err)
	}

	return nil
}

// GetRecentShoppingLists returns recently generated shopping lists
func (s *ProcurementService) GetRecentShoppingLists(limit int) ([]map[string]interface{}, error) {
	query := `
		SELECT list_id, items, generated_date, completed, created_at
		FROM shopping_list
		ORDER BY created_at DESC
		LIMIT $1
	`

	rows, err := s.db.Query(query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query shopping lists: %v", err)
	}
	defer rows.Close()

	var lists []map[string]interface{}

	for rows.Next() {
		var listID string
		var itemsJSON []byte
		var generatedDate string
		var completed bool
		var createdAt time.Time

		if err := rows.Scan(&listID, &itemsJSON, &generatedDate, &completed, &createdAt); err != nil {
			log.Printf("Error scanning shopping list: %v", err)
			continue
		}

		var items []models.ShoppingListItem
		if err := json.Unmarshal(itemsJSON, &items); err != nil {
			log.Printf("Error unmarshaling shopping list items: %v", err)
			continue
		}

		lists = append(lists, map[string]interface{}{
			"list_id":        listID,
			"items":          items,
			"generated_date": generatedDate,
			"completed":      completed,
			"created_at":     createdAt,
			"item_count":     len(items),
		})
	}

	return lists, nil
}

// normalizeItemName converts item name to lowercase and removes extra spaces
func normalizeItemName(name string) string {
	// Simple normalization - in production would use more sophisticated matching
	normalized := ""
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c >= 'A' && c <= 'Z' {
			normalized += string(c + 32) // to lowercase
		} else if c == ' ' || c == '-' || c == '_' {
			// skip separators
		} else {
			normalized += string(c)
		}
	}
	return normalized
}

// countLowStockItems counts items with priority 1 or 2
func countLowStockItems(items []models.ShoppingListItem) int {
	count := 0
	for _, item := range items {
		if item.Priority == 1 || item.Priority == 2 {
			count++
		}
	}
	return count
}

// countExpiringItems counts items with priority 1 (expiring soon)
func countExpiringItems(items []models.ShoppingListItem) int {
	count := 0
	for _, item := range items {
		if item.Priority == 1 {
			count++
		}
	}
	return count
}

// GetProcurementSummary returns a summary of procurement status
func (s *ProcurementService) GetProcurementSummary() (map[string]interface{}, error) {
	lowStockItems, err := s.GetLowStockItems()
	if err != nil {
		return nil, err
	}

	expiringItems, err := s.getExpiringItemsForReplacement(3)
	if err != nil {
		return nil, err
	}

	// Get recent shopping lists
	recentLists, err := s.GetRecentShoppingLists(3)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"low_stock_count": len(lowStockItems),
		"expiring_count":  len(expiringItems),
		"recent_lists":    recentLists,
		"generated_at":    time.Now(),
		"recommendation":  generateProcurementRecommendation(lowStockItems, expiringItems),
	}, nil
}

// generateProcurementRecommendation generates a human-readable recommendation
func generateProcurementRecommendation(lowStock []LowStockItem, expiring []models.ExpiringItem) string {
	if len(lowStock) == 0 && len(expiring) == 0 {
		return "Stock levels are good. No immediate procurement needed."
	}

	criticalItems := 0
	for _, item := range lowStock {
		if item.Priority == 1 {
			criticalItems++
		}
	}

	if criticalItems > 0 {
		return fmt.Sprintf("⚠️ %d items are critically low. Consider shopping soon.", criticalItems)
	}

	if len(lowStock) > 0 {
		return fmt.Sprintf("📝 %d items are running low. Plan your next shopping trip.", len(lowStock))
	}

	if len(expiring) > 0 {
		return fmt.Sprintf("⏰ %d items are expiring soon. Use them or replace them.", len(expiring))
	}

	return "Stock status is being monitored."
}

// PreMarketPingRequest represents a request to send pre-market ping to cook
type PreMarketPingRequest struct {
	Language   string `json:"language"`
	TestMode   bool   `json:"test_mode"`
	IncludeAll bool   `json:"include_all"` // Include all items or just critical ones
}

// PreMarketPingResponse represents the response from pre-market ping
type PreMarketPingResponse struct {
	Sent          bool     `json:"sent"`
	Message       string   `json:"message"`
	ItemsIncluded []string `json:"items_included"`
	WhatsappURL   string   `json:"whatsapp_url,omitempty"`
	Error         string   `json:"error,omitempty"`
}

// SendPreMarketPing builds a WhatsApp compose link for low-stock items (user sends from their app).
func (s *ProcurementService) SendPreMarketPing(req PreMarketPingRequest) (*PreMarketPingResponse, error) {
	// Get low stock items
	lowStockItems, err := s.GetLowStockItems()
	if err != nil {
		return nil, fmt.Errorf("failed to get low stock items: %v", err)
	}

	if len(lowStockItems) == 0 {
		return &PreMarketPingResponse{
			Sent:          false,
			Message:       "No low stock items found. No ping sent.",
			ItemsIncluded: []string{},
		}, nil
	}

	// Filter items based on priority
	var itemsToInclude []LowStockItem
	for _, item := range lowStockItems {
		if req.IncludeAll || item.Priority == 1 {
			itemsToInclude = append(itemsToInclude, item)
		}
	}

	if len(itemsToInclude) == 0 {
		return &PreMarketPingResponse{
			Sent:          false,
			Message:       "No critical items found. No ping sent.",
			ItemsIncluded: []string{},
		}, nil
	}

	// Get cook's phone number from profile
	cookProfile, err := s.getCookProfile()
	if err != nil {
		return nil, fmt.Errorf("failed to get cook profile: %v", err)
	}

	if cookProfile.PhoneNumber == "" {
		return &PreMarketPingResponse{
			Sent:          false,
			Message:       "Cook phone number not found. Add it in cook profile to open WhatsApp.",
			ItemsIncluded: getItemNames(itemsToInclude),
			Error:         "missing_phone_number",
		}, nil
	}

	message := buildPreMarketMessage(itemsToInclude, req.Language)
	waURL, err := BuildWaMeURL(cookProfile.PhoneNumber, message)
	if err != nil {
		return &PreMarketPingResponse{
			Sent:          false,
			Message:       fmt.Sprintf("Could not build WhatsApp link: %v", err),
			ItemsIncluded: getItemNames(itemsToInclude),
			Error:         err.Error(),
		}, nil
	}

	return &PreMarketPingResponse{
		Sent:          true,
		Message:       "Open WhatsApp to send this pre-market reminder to your cook.",
		WhatsappURL:   waURL,
		ItemsIncluded: getItemNames(itemsToInclude),
	}, nil
}

// buildPreMarketMessage builds a message for the cook about low stock items
func buildPreMarketMessage(items []LowStockItem, language string) string {
	// For now, build in English
	// In production, this would use the translation service
	message := "🛒 Pre-Market Reminder:\n\n"
	message += "The following items are running low:\n\n"

	for i, item := range items {
		priorityEmoji := "⚠️"
		if item.Priority == 1 {
			priorityEmoji = "🚨"
		}

		message += fmt.Sprintf("%d. %s %s - Current: %.1f %s, Need: %.1f %s\n",
			i+1, priorityEmoji, item.Name, item.CurrentQty, item.Unit, item.RecommendedQty, item.Unit)
	}

	message += "\nPlease let me know if you need anything else!"
	return message
}

// getCookProfile retrieves the cook profile from database
func (s *ProcurementService) getCookProfile() (*models.CookProfile, error) {
	query := `
		SELECT cook_id, COALESCE(cook_name, ''), dishes_known, preferred_lang, phone_number, created_at, updated_at
		FROM cook_profile
		LIMIT 1
	`

	row := s.db.QueryRow(query)
	var profile models.CookProfile
	var dishesKnownStr string
	var phoneNumber sql.NullString

	err := row.Scan(
		&profile.CookID,
		&profile.CookName,
		&dishesKnownStr,
		&profile.PreferredLang,
		&phoneNumber,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			// Return default profile for testing
			return &models.CookProfile{
				CookID:        "default-cook",
				DishesKnown:   []string{"paneer butter masala", "dal tadka", "roti"},
				PreferredLang: "hi",
				PhoneNumber:   "+919876543210",
			}, nil
		}
		return nil, fmt.Errorf("failed to get cook profile: %v", err)
	}

	// Parse dishes_known array (stored as PostgreSQL array string)
	// Simple parsing - in production would use proper array parsing
	profile.DishesKnown = parsePostgreSQLArray(dishesKnownStr)
	if phoneNumber.Valid {
		profile.PhoneNumber = phoneNumber.String
	}

	return &profile, nil
}

// parsePostgreSQLArray parses a PostgreSQL array string into slice
func parsePostgreSQLArray(arrayStr string) []string {
	// Simple parsing for format: {"item1","item2","item3"}
	if len(arrayStr) < 2 {
		return []string{}
	}

	// Remove curly braces
	trimmed := strings.Trim(arrayStr, "{}")
	if trimmed == "" {
		return []string{}
	}

	// Split by comma
	return strings.Split(trimmed, ",")
}

// getItemNames extracts names from low stock items
func getItemNames(items []LowStockItem) []string {
	names := make([]string, len(items))
	for i, item := range items {
		names[i] = item.Name
	}
	return names
}

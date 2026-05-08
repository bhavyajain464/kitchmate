package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"
)

// ScanBillRequest represents the request body for bill scanning
type ScanBillRequest struct {
	ImageData string `json:"image_data"` // Base64 encoded image
	ImageType string `json:"image_type"` // MIME type like "image/jpeg", "image/png"
}

// ScanBillResponse represents the response from bill scanning
type ScanBillResponse struct {
	Success bool                     `json:"success"`
	Message string                   `json:"message,omitempty"`
	Items   []services.BillItem      `json:"items,omitempty"`
	Added   []map[string]interface{} `json:"added_to_inventory,omitempty"`
	Errors  []string                 `json:"errors,omitempty"`
}

// ScanBill handles bill scanning using Gemini AI
func ScanBill(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only accept POST requests
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Parse request body
		var req ScanBillRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		// Validate required fields
		if req.ImageData == "" {
			http.Error(w, "image_data is required", http.StatusBadRequest)
			return
		}

		if req.ImageType == "" {
			// Try to infer from common formats
			if strings.HasPrefix(req.ImageData, "/9j/") || strings.HasPrefix(req.ImageData, "/9j/") {
				req.ImageType = "image/jpeg"
			} else if strings.HasPrefix(req.ImageData, "iVBORw0KGgo") {
				req.ImageType = "image/png"
			} else {
				req.ImageType = "image/jpeg" // Default
			}
		}

		// Initialize Gemini service
		geminiService, err := services.NewGeminiService(cfg.GeminiAPIKey, cfg.GeminiModel)
		if err != nil {
			response := ScanBillResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to initialize Gemini service: %v", err),
			}
			writeJSONResponse(w, http.StatusInternalServerError, response)
			return
		}
		defer geminiService.Close()

		// Scan the bill
		items, err := geminiService.ScanBillFromBase64(req.ImageData, req.ImageType)
		if err != nil {
			response := ScanBillResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to scan bill: %v", err),
			}
			writeJSONResponse(w, http.StatusInternalServerError, response)
			return
		}

		// Add items to inventory
		addedItems, errors := addItemsToInventory(db, items)

		// Prepare response
		response := ScanBillResponse{
			Success: true,
			Message: fmt.Sprintf("Successfully scanned bill and found %d items", len(items)),
			Items:   items,
			Added:   addedItems,
		}

		if len(errors) > 0 {
			response.Errors = errors
		}

		writeJSONResponse(w, http.StatusOK, response)
	}
}

// ScanBillMultipart handles bill scanning with multipart form data (file upload)
func ScanBillMultipart(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only accept POST requests
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Parse multipart form (max 10MB)
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, "Failed to parse form", http.StatusBadRequest)
			return
		}

		// Get the file from form data
		file, header, err := r.FormFile("bill_image")
		if err != nil {
			http.Error(w, "No bill_image file provided", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Read file data
		fileData, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, "Failed to read file", http.StatusInternalServerError)
			return
		}

		// Get image type from header
		imageType := header.Header.Get("Content-Type")
		if imageType == "" {
			// Try to infer from filename
			if strings.HasSuffix(strings.ToLower(header.Filename), ".jpg") ||
				strings.HasSuffix(strings.ToLower(header.Filename), ".jpeg") {
				imageType = "image/jpeg"
			} else if strings.HasSuffix(strings.ToLower(header.Filename), ".png") {
				imageType = "image/png"
			} else {
				imageType = "image/jpeg" // Default
			}
		}

		// Initialize Gemini service
		geminiService, err := services.NewGeminiService(cfg.GeminiAPIKey, cfg.GeminiModel)
		if err != nil {
			response := ScanBillResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to initialize Gemini service: %v", err),
			}
			writeJSONResponse(w, http.StatusInternalServerError, response)
			return
		}
		defer geminiService.Close()

		// Scan the bill
		items, err := geminiService.ScanBill(fileData, imageType)
		if err != nil {
			response := ScanBillResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to scan bill: %v", err),
			}
			writeJSONResponse(w, http.StatusInternalServerError, response)
			return
		}

		// Add items to inventory
		addedItems, errors := addItemsToInventory(db, items)

		// Prepare response
		response := ScanBillResponse{
			Success: true,
			Message: fmt.Sprintf("Successfully scanned bill and found %d items", len(items)),
			Items:   items,
			Added:   addedItems,
		}

		if len(errors) > 0 {
			response.Errors = errors
		}

		writeJSONResponse(w, http.StatusOK, response)
	}
}

// addItemsToInventory adds scanned bill items to the inventory database
func addItemsToInventory(db *sql.DB, items []services.BillItem) ([]map[string]interface{}, []string) {
	var addedItems []map[string]interface{}
	var errors []string

	for _, item := range items {
		// Check if item already exists in inventory
		var existingID int
		err := db.QueryRow(`
			SELECT item_id FROM inventory 
			WHERE canonical_name = $1 AND unit = $2
			LIMIT 1
		`, item.Name, item.Unit).Scan(&existingID)

		if err == nil {
			// Item exists, update quantity
			_, err = db.Exec(`
				UPDATE inventory 
				SET qty = qty + $1, updated_at = NOW()
				WHERE item_id = $2
			`, item.Quantity, existingID)

			if err != nil {
				errors = append(errors, fmt.Sprintf("Failed to update %s: %v", item.Name, err))
				continue
			}

			addedItems = append(addedItems, map[string]interface{}{
				"item_id":   existingID,
				"name":      item.Name,
				"quantity":  item.Quantity,
				"unit":      item.Unit,
				"action":    "updated",
				"new_total": nil, // We'd need to query to get the new total
			})
		} else if err == sql.ErrNoRows {
			// Item doesn't exist, insert new
			var itemID int
			err = db.QueryRow(`
				INSERT INTO inventory (canonical_name, qty, unit, is_manual, created_at, updated_at)
				VALUES ($1, $2, $3, false, NOW(), NOW())
				RETURNING item_id
			`, item.Name, item.Quantity, item.Unit).Scan(&itemID)

			if err != nil {
				errors = append(errors, fmt.Sprintf("Failed to insert %s: %v", item.Name, err))
				continue
			}

			addedItems = append(addedItems, map[string]interface{}{
				"item_id":  itemID,
				"name":     item.Name,
				"quantity": item.Quantity,
				"unit":     item.Unit,
				"action":   "added",
			})
		} else {
			// Other database error
			errors = append(errors, fmt.Sprintf("Database error for %s: %v", item.Name, err))
		}
	}

	return addedItems, errors
}

// writeJSONResponse writes a JSON response with the given status code
func writeJSONResponse(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

// TestScanBill is a test endpoint that returns mock data without calling Gemini
func TestScanBill(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Return mock bill items for testing
		mockItems := []services.BillItem{
			{Name: "Basmati Rice", Quantity: 5, Unit: "kg", PricePerUnit: 120, TotalPrice: 600},
			{Name: "Tomatoes", Quantity: 2, Unit: "kg", PricePerUnit: 40, TotalPrice: 80},
			{Name: "Onions", Quantity: 3, Unit: "kg", PricePerUnit: 30, TotalPrice: 90},
			{Name: "Potatoes", Quantity: 4, Unit: "kg", PricePerUnit: 25, TotalPrice: 100},
			{Name: "Milk", Quantity: 2, Unit: "litre", PricePerUnit: 60, TotalPrice: 120},
		}

		// Add mock items to inventory
		addedItems, errors := addItemsToInventory(db, mockItems)

		response := ScanBillResponse{
			Success: true,
			Message: "Test scan completed successfully (mock data)",
			Items:   mockItems,
			Added:   addedItems,
		}

		if len(errors) > 0 {
			response.Errors = errors
		}

		writeJSONResponse(w, http.StatusOK, response)
	}
}

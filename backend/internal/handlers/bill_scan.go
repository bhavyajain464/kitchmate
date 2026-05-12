package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

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

// ScanBill handles bill scanning — extracts items only, does NOT auto-add to inventory.
// The frontend shows results for user confirmation, then calls POST /inventory for each confirmed item.
func ScanBill(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req ScanBillRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.ImageData == "" {
			http.Error(w, "image_data is required", http.StatusBadRequest)
			return
		}

		if req.ImageType == "" {
			if strings.HasPrefix(req.ImageData, "/9j/") {
				req.ImageType = "image/jpeg"
			} else if strings.HasPrefix(req.ImageData, "iVBORw0KGgo") {
				req.ImageType = "image/png"
			} else {
				req.ImageType = "image/jpeg"
			}
		}

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

		items, err := geminiService.ScanBillFromBase64(req.ImageData, req.ImageType)
		if err != nil {
			response := ScanBillResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to scan bill: %v", err),
			}
			writeJSONResponse(w, http.StatusInternalServerError, response)
			return
		}

		response := ScanBillResponse{
			Success: true,
			Message: fmt.Sprintf("Found %d edible items on this bill", len(items)),
			Items:   items,
		}

		writeJSONResponse(w, http.StatusOK, response)
	}
}

// ScanBillMultipart handles bill scanning with multipart form data (file upload)
func ScanBillMultipart(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID := getUserID(r)

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

		addedItems, errors := addItemsToInventory(db, items, userID)

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

func addItemsToInventory(db *sql.DB, items []services.BillItem, userID string) ([]map[string]interface{}, []string) {
	var addedItems []map[string]interface{}
	var errors []string

	for _, item := range items {
		shelfDays := item.ShelfLifeDays
		if shelfDays <= 0 {
			shelfDays = 7
		}
		expiry := time.Now().AddDate(0, 0, shelfDays)

		var existingID string
		err := db.QueryRow(`
			SELECT item_id FROM inventory 
			WHERE LOWER(canonical_name) = LOWER($1) AND unit = $2 AND (user_id = $3 OR user_id IS NULL)
			LIMIT 1
		`, item.Name, item.Unit, userID).Scan(&existingID)

		if err == nil {
			_, err = db.Exec(`
				UPDATE inventory 
				SET qty = qty + $1, estimated_expiry = LEAST(estimated_expiry, $2), user_id = COALESCE(user_id, $3), updated_at = NOW()
				WHERE item_id = $4
			`, item.Quantity, expiry, userID, existingID)

			if err != nil {
				errors = append(errors, fmt.Sprintf("Failed to update %s: %v", item.Name, err))
				continue
			}

			addedItems = append(addedItems, map[string]interface{}{
				"item_id":         existingID,
				"name":            item.Name,
				"quantity":        item.Quantity,
				"unit":            item.Unit,
				"action":          "updated",
				"shelf_life_days": shelfDays,
				"estimated_expiry": expiry.Format("2006-01-02"),
			})
		} else if err == sql.ErrNoRows {
			var itemID string
			err = db.QueryRow(`
				INSERT INTO inventory (canonical_name, qty, unit, estimated_expiry, user_id, is_manual, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, false, NOW(), NOW())
				RETURNING item_id
			`, item.Name, item.Quantity, item.Unit, expiry, userID).Scan(&itemID)

			if err != nil {
				errors = append(errors, fmt.Sprintf("Failed to insert %s: %v", item.Name, err))
				continue
			}

			addedItems = append(addedItems, map[string]interface{}{
				"item_id":         itemID,
				"name":            item.Name,
				"quantity":        item.Quantity,
				"unit":            item.Unit,
				"action":          "added",
				"shelf_life_days": shelfDays,
				"estimated_expiry": expiry.Format("2006-01-02"),
			})
		} else {
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
		userID := getUserID(r)

		mockItems := []services.BillItem{
			{Name: "Basmati Rice", Quantity: 5, Unit: "kg", PricePerUnit: 120, TotalPrice: 600, ShelfLifeDays: 60},
			{Name: "Tomatoes", Quantity: 2, Unit: "kg", PricePerUnit: 40, TotalPrice: 80, ShelfLifeDays: 7},
			{Name: "Onions", Quantity: 3, Unit: "kg", PricePerUnit: 30, TotalPrice: 90, ShelfLifeDays: 14},
			{Name: "Potatoes", Quantity: 4, Unit: "kg", PricePerUnit: 25, TotalPrice: 100, ShelfLifeDays: 14},
			{Name: "Milk", Quantity: 2, Unit: "litre", PricePerUnit: 60, TotalPrice: 120, ShelfLifeDays: 3},
		}

		addedItems, errors := addItemsToInventory(db, mockItems, userID)

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

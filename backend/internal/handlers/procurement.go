package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"kitchenai-backend/internal/services"
)

// GetShoppingListHandler returns a shopping list based on low stock and expiring items
func GetShoppingListHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		procurementService := services.NewProcurementService(db)

		var req services.ShoppingListRequest
		if r.Method == http.MethodPost {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
				return
			}
		} else {
			// Default values for GET request
			req = services.ShoppingListRequest{
				IncludeLowStock: true,
				IncludeExpiring: true,
				MaxItems:        20,
			}
		}

		shoppingList, err := procurementService.GenerateShoppingList(req)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to generate shopping list: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(shoppingList)
	}
}

// GetLowStockItemsHandler returns items that are below minimum threshold
func GetLowStockItemsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		procurementService := services.NewProcurementService(db)

		lowStockItems, err := procurementService.GetLowStockItems()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get low stock items: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"low_stock_items": lowStockItems,
			"count":           len(lowStockItems),
		})
	}
}

// SendPreMarketPingHandler sends a WhatsApp message to cook about low stock items
func SendPreMarketPingHandler(db *sql.DB, whatsappService *services.WhatsAppService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req services.PreMarketPingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		procurementService := services.NewProcurementService(db)

		response, err := procurementService.SendPreMarketPing(whatsappService, req)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to send pre-market ping: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
}

// GetProcurementSummaryHandler returns a summary of procurement status
func GetProcurementSummaryHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		procurementService := services.NewProcurementService(db)

		summary, err := procurementService.GetProcurementSummary()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get procurement summary: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(summary)
	}
}

// GetRecentShoppingListsHandler returns recent shopping lists
func GetRecentShoppingListsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		procurementService := services.NewProcurementService(db)

		// Get limit from query parameter, default to 5
		limit := 5
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			if _, err := fmt.Sscanf(limitStr, "%d", &limit); err != nil {
				limit = 5
			}
		}

		shoppingLists, err := procurementService.GetRecentShoppingLists(limit)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get recent shopping lists: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"shopping_lists": shoppingLists,
			"count":          len(shoppingLists),
		})
	}
}

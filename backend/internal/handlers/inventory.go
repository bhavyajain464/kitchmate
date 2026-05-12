package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"kitchenai-backend/internal/middleware"
	"kitchenai-backend/internal/models"

	"github.com/gorilla/mux"
)

func getUserID(r *http.Request) string {
	if session := middleware.GetAuthSession(r); session != nil && session.User != nil {
		return session.User.UserID
	}
	return ""
}

// GetInventory returns all inventory items for the authenticated user
func GetInventory(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		rows, err := db.Query(`
			SELECT item_id, canonical_name, qty, unit, estimated_expiry, is_manual, created_at, updated_at
			FROM inventory
			WHERE user_id = $1 OR user_id IS NULL
			ORDER BY created_at DESC
		`, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		items := make([]models.Inventory, 0)
		for rows.Next() {
			var item models.Inventory
			var expiry sql.NullTime
			err := rows.Scan(
				&item.ItemID,
				&item.CanonicalName,
				&item.Qty,
				&item.Unit,
				&expiry,
				&item.IsManual,
				&item.CreatedAt,
				&item.UpdatedAt,
			)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			item.EstimatedExpiry = models.NullTime(expiry)
			items = append(items, item)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(items)
	}
}

// GetInventoryItem returns a single inventory item by ID
func GetInventoryItem(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]
		userID := getUserID(r)

		var item models.Inventory
		var expiry sql.NullTime
		err := db.QueryRow(`
			SELECT item_id, canonical_name, qty, unit, estimated_expiry, is_manual, created_at, updated_at
			FROM inventory
			WHERE item_id = $1 AND (user_id = $2 OR user_id IS NULL)
		`, id, userID).Scan(
			&item.ItemID,
			&item.CanonicalName,
			&item.Qty,
			&item.Unit,
			&expiry,
			&item.IsManual,
			&item.CreatedAt,
			&item.UpdatedAt,
		)

		if err == sql.ErrNoRows {
			http.Error(w, "Item not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		item.EstimatedExpiry = models.NullTime(expiry)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(item)
	}
}

// CreateInventoryItem creates a new inventory item
func CreateInventoryItem(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req models.InventoryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if req.CanonicalName == "" || req.Qty <= 0 || req.Unit == "" {
			http.Error(w, "Missing required fields", http.StatusBadRequest)
			return
		}

		var expiry *time.Time
		if req.EstimatedExpiry != "" {
			parsedTime, err := time.Parse("2006-01-02", req.EstimatedExpiry)
			if err != nil {
				http.Error(w, "Invalid date format. Use YYYY-MM-DD", http.StatusBadRequest)
				return
			}
			expiry = &parsedTime
		}

		var itemID string
		var createdAt, updatedAt time.Time
		var dbExpiry sql.NullTime

		if expiry != nil {
			err := db.QueryRow(`
				INSERT INTO inventory (canonical_name, qty, unit, estimated_expiry, is_manual, user_id)
				VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING item_id, created_at, updated_at, estimated_expiry
			`, req.CanonicalName, req.Qty, req.Unit, *expiry, req.IsManual, userID).Scan(&itemID, &createdAt, &updatedAt, &dbExpiry)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			err := db.QueryRow(`
				INSERT INTO inventory (canonical_name, qty, unit, is_manual, user_id)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING item_id, created_at, updated_at, estimated_expiry
			`, req.CanonicalName, req.Qty, req.Unit, req.IsManual, userID).Scan(&itemID, &createdAt, &updatedAt, &dbExpiry)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		item := models.Inventory{
			ItemID:          itemID,
			CanonicalName:   req.CanonicalName,
			Qty:             req.Qty,
			Unit:            req.Unit,
			EstimatedExpiry: models.NullTime(dbExpiry),
			IsManual:        req.IsManual,
			CreatedAt:       createdAt,
			UpdatedAt:       updatedAt,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(item)
	}
}

// UpdateInventoryItem updates an existing inventory item
func UpdateInventoryItem(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]

		var req models.InventoryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate required fields
		if req.CanonicalName == "" || req.Qty <= 0 || req.Unit == "" {
			http.Error(w, "Missing required fields", http.StatusBadRequest)
			return
		}

		var expiry *time.Time
		if req.EstimatedExpiry != "" {
			parsedTime, err := time.Parse("2006-01-02", req.EstimatedExpiry)
			if err != nil {
				http.Error(w, "Invalid date format. Use YYYY-MM-DD", http.StatusBadRequest)
				return
			}
			expiry = &parsedTime
		}

		userID := getUserID(r)
		var result sql.Result
		var err error
		if expiry != nil {
			result, err = db.Exec(`
				UPDATE inventory
				SET canonical_name = $1, qty = $2, unit = $3, estimated_expiry = $4, is_manual = $5
				WHERE item_id = $6 AND (user_id = $7 OR user_id IS NULL)
			`, req.CanonicalName, req.Qty, req.Unit, *expiry, req.IsManual, id, userID)
		} else {
			result, err = db.Exec(`
				UPDATE inventory
				SET canonical_name = $1, qty = $2, unit = $3, estimated_expiry = NULL, is_manual = $4
				WHERE item_id = $5 AND (user_id = $6 OR user_id IS NULL)
			`, req.CanonicalName, req.Qty, req.Unit, req.IsManual, id, userID)
		}

		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		rowsAffected, _ := result.RowsAffected()
		if rowsAffected == 0 {
			http.Error(w, "Item not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "Item updated successfully"})
	}
}

// DeleteInventoryItem deletes an inventory item
func DeleteInventoryItem(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id := vars["id"]

		userID := getUserID(r)
		result, err := db.Exec("DELETE FROM inventory WHERE item_id = $1 AND (user_id = $2 OR user_id IS NULL)", id, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		rowsAffected, _ := result.RowsAffected()
		if rowsAffected == 0 {
			http.Error(w, "Item not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "Item deleted successfully"})
	}
}

// GetExpiringItems returns items that are expiring soon (within 3 days)
func GetExpiringItems(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		rows, err := db.Query(`
			SELECT 
				item_id, 
				canonical_name, 
				qty, 
				unit, 
				estimated_expiry,
				(estimated_expiry - CURRENT_DATE) as days_until_expiry
			FROM inventory 
			WHERE estimated_expiry IS NOT NULL 
				AND estimated_expiry >= CURRENT_DATE - INTERVAL '2 days'
				AND estimated_expiry <= CURRENT_DATE + INTERVAL '7 days'
				AND (user_id = $1 OR user_id IS NULL)
			ORDER BY estimated_expiry ASC
		`, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		items := make([]models.ExpiringItem, 0)
		for rows.Next() {
			var item models.ExpiringItem
			err := rows.Scan(
				&item.ItemID,
				&item.CanonicalName,
				&item.Qty,
				&item.Unit,
				&item.EstimatedExpiry,
				&item.DaysUntilExpiry,
			)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			items = append(items, item)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(items)
	}
}

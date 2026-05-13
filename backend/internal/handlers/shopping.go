package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
)

type ShoppingItem struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id,omitempty"`
	Name      string     `json:"name"`
	Qty       float64    `json:"qty"`
	Unit      string     `json:"unit"`
	Bought    bool       `json:"bought"`
	CreatedAt time.Time  `json:"created_at"`
	BoughtAt  *time.Time `json:"bought_at,omitempty"`
}

type AddShoppingItemReq struct {
	Name string  `json:"name"`
	Qty  float64 `json:"qty"`
	Unit string  `json:"unit"`
}

func GetShoppingItems(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		rows, err := db.Query(`
			SELECT id, name, qty, unit, bought, created_at, bought_at
			FROM shopping_items
			WHERE user_id = $1
			ORDER BY bought ASC, created_at DESC
		`, userID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()

		items := []ShoppingItem{}
		for rows.Next() {
			var item ShoppingItem
			if err := rows.Scan(&item.ID, &item.Name, &item.Qty, &item.Unit, &item.Bought, &item.CreatedAt, &item.BoughtAt); err != nil {
				log.Printf("scan shopping item: %v", err)
				continue
			}
			items = append(items, item)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"items": items,
			"count": len(items),
		})
	}
}

func AddShoppingItem(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req AddShoppingItemReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", 400)
			return
		}
		if req.Name == "" {
			http.Error(w, "name required", 400)
			return
		}
		if req.Qty <= 0 {
			req.Qty = 1
		}
		if req.Unit == "" {
			req.Unit = "pcs"
		}

		var item ShoppingItem
		err := db.QueryRow(`
			INSERT INTO shopping_items (user_id, name, qty, unit)
			VALUES ($1, $2, $3, $4)
			RETURNING id, name, qty, unit, bought, created_at
		`, userID, req.Name, req.Qty, req.Unit).Scan(
			&item.ID, &item.Name, &item.Qty, &item.Unit, &item.Bought, &item.CreatedAt,
		)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(item)
	}
}

func AddBulkShoppingItems(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var items []AddShoppingItemReq
		if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
			http.Error(w, "invalid body", 400)
			return
		}

		added := []ShoppingItem{}
		for _, req := range items {
			if req.Name == "" {
				continue
			}
			if req.Qty <= 0 {
				req.Qty = 1
			}
			if req.Unit == "" {
				req.Unit = "pcs"
			}
			var item ShoppingItem
			err := db.QueryRow(`
				INSERT INTO shopping_items (user_id, name, qty, unit)
				VALUES ($1, $2, $3, $4)
				RETURNING id, name, qty, unit, bought, created_at
			`, userID, req.Name, req.Qty, req.Unit).Scan(
				&item.ID, &item.Name, &item.Qty, &item.Unit, &item.Bought, &item.CreatedAt,
			)
			if err != nil {
				log.Printf("bulk add shopping item error: %v", err)
				continue
			}
			added = append(added, item)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"items": added,
			"count": len(added),
		})
	}
}

func ToggleShoppingItem(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		itemID := mux.Vars(r)["id"]

		var bought bool
		err := db.QueryRow(`SELECT bought FROM shopping_items WHERE id = $1 AND user_id = $2`, itemID, userID).Scan(&bought)
		if err != nil {
			http.Error(w, "not found", 404)
			return
		}

		newBought := !bought
		var boughtAt interface{}
		if newBought {
			boughtAt = time.Now()
		}

		_, err = db.Exec(`UPDATE shopping_items SET bought = $1, bought_at = $2 WHERE id = $3 AND user_id = $4`,
			newBought, boughtAt, itemID, userID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"bought": newBought})
	}
}

func DeleteShoppingItem(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		itemID := mux.Vars(r)["id"]

		_, err := db.Exec(`DELETE FROM shopping_items WHERE id = $1 AND user_id = $2`, itemID, userID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		w.WriteHeader(204)
	}
}

// RemoveFromShoppingList removes items from the user's shopping list that match the given item name.
// Called automatically when items are added to inventory.
func RemoveFromShoppingList(db *sql.DB, userID string, itemName string) {
	_, err := db.Exec(`
		DELETE FROM shopping_items
		WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND bought = FALSE
	`, userID, itemName)
	if err != nil {
		log.Printf("auto-remove shopping item %q for user %s: %v", itemName, userID, err)
	}
}

func ClearBoughtItems(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)

		result, err := db.Exec(`DELETE FROM shopping_items WHERE user_id = $1 AND bought = TRUE`, userID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		count, _ := result.RowsAffected()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"cleared": count})
	}
}

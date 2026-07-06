package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"kitchenai-backend/internal/models"
	"kitchenai-backend/internal/services/ingredients"
	"kitchenai-backend/pkg/units"
)

type inventoryPageFilters struct {
	wantActive     bool
	wantExpiring   bool
	wantExpired    bool
	expiringOnly   bool
	q              string
	foodGroup      string
}

type inventoryListPage struct {
	Items       []models.InventoryPageItem   `json:"items"`
	Total       int                          `json:"total"`
	Offset      int                          `json:"offset"`
	Limit       int                          `json:"limit"`
	HasMore     bool                         `json:"has_more"`
	Counts      models.InventoryBucketCounts `json:"counts"`
	GroupCounts map[string]int               `json:"group_counts,omitempty"`
}

func parseInventoryPageFilters(r *http.Request) (inventoryPageFilters, error) {
	wantActive, wantExpiring, wantExpired, ok := parseInventoryInclude(r.URL.Query().Get("include"))
	if !ok {
		return inventoryPageFilters{}, fmt.Errorf("invalid include: use active, expiring, expired")
	}
	if !wantActive && !wantExpiring && !wantExpired {
		return inventoryPageFilters{}, fmt.Errorf("include must list at least one bucket")
	}
	expiringOnly := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("expiring_only")), "true")
	if expiringOnly {
		wantActive = false
		wantExpired = false
		wantExpiring = true
	}
	return inventoryPageFilters{
		wantActive:   wantActive,
		wantExpiring: wantExpiring,
		wantExpired:  wantExpired,
		expiringOnly: expiringOnly,
		q:            strings.TrimSpace(r.URL.Query().Get("q")),
		foodGroup:    normalizeInventoryFoodGroupFilter(r.URL.Query().Get("food_group")),
	}, nil
}

func normalizeInventoryFoodGroupFilter(raw string) string {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" || raw == "all" {
		return ""
	}
	return raw
}

func inventoryGroupID(foodGroup string) string {
	fg := strings.TrimSpace(strings.ToLower(foodGroup))
	if fg == "" {
		return "other"
	}
	if fg == "protein" {
		return "non_veg"
	}
	return fg
}

func inventoryFoodGroupSQL(filter string, argPos int) (clause string, args []interface{}) {
	if filter == "" {
		return "", nil
	}
	if filter == "non_veg" {
		return fmt.Sprintf(" AND COALESCE(NULLIF(food_group, ''), 'other') IN ('non_veg', 'protein')"), nil
	}
	return fmt.Sprintf(" AND COALESCE(NULLIF(food_group, ''), 'other') = $%d", argPos), []interface{}{filter}
}

func inventoryBucketSQL(filters inventoryPageFilters, kitchenArg int) string {
	parts := make([]string, 0, 3)
	if filters.wantActive {
		parts = append(parts, fmt.Sprintf(`(
			estimated_expiry IS NULL
			OR estimated_expiry > CURRENT_DATE + %d::int
		)`, expiringSoonDays))
	}
	if filters.wantExpiring {
		parts = append(parts, fmt.Sprintf(`(
			estimated_expiry IS NOT NULL
			AND estimated_expiry >= CURRENT_DATE
			AND estimated_expiry <= CURRENT_DATE + %d::int
		)`, expiringSoonDays))
	}
	if filters.wantExpired {
		parts = append(parts, fmt.Sprintf(`(
			estimated_expiry IS NOT NULL
			AND estimated_expiry < CURRENT_DATE
			AND estimated_expiry >= CURRENT_DATE - %d::int
		)`, expiredRetentionDays))
	}
	return fmt.Sprintf("kitchen_id = $%d AND (%s)", kitchenArg, strings.Join(parts, " OR "))
}

func inventorySearchSQL(q string, argPos int) (clause string, args []interface{}) {
	q = strings.TrimSpace(q)
	if q == "" {
		return "", nil
	}
	return fmt.Sprintf(" AND canonical_name ILIKE '%%' || $%d || '%%'", argPos), []interface{}{q}
}

func appendInventoryFilterClauses(where string, args []interface{}, filters inventoryPageFilters, includeFoodGroup bool) (string, []interface{}) {
	if strings.TrimSpace(filters.q) != "" {
		argPos := len(args) + 1
		clause, clauseArgs := inventorySearchSQL(filters.q, argPos)
		where += clause
		args = append(args, clauseArgs...)
	}
	if includeFoodGroup && filters.foodGroup != "" {
		clause, clauseArgs := inventoryFoodGroupSQL(filters.foodGroup, len(args)+1)
		where += clause
		args = append(args, clauseArgs...)
	}
	return where, args
}

func inventoryGroupCountsQuery(kitchenID string, filters inventoryPageFilters) (string, []interface{}) {
	args := []interface{}{kitchenID}
	bucketClause := inventoryBucketSQL(groupCountBucketFilters(filters), 1)
	return fmt.Sprintf(`
		SELECT COALESCE(NULLIF(food_group, ''), 'other') AS fg, COUNT(*)
		FROM inventory
		WHERE %s
		GROUP BY fg`, bucketClause), args
}

// groupCountBucketFilters returns bucket scope for pill counts. List filters like
// expiring_only, search, and food_group must not shrink category pill totals.
func groupCountBucketFilters(filters inventoryPageFilters) inventoryPageFilters {
	if filters.wantExpired && !filters.wantActive && !filters.wantExpiring {
		return inventoryPageFilters{wantExpired: true}
	}
	return inventoryPageFilters{wantActive: true, wantExpiring: true}
}

func inventoryOrderSQL(filters inventoryPageFilters) string {
	if filters.wantExpired && !filters.wantActive && !filters.wantExpiring {
		return "estimated_expiry DESC, canonical_name ASC"
	}
	return "estimated_expiry ASC NULLS LAST, canonical_name ASC"
}

func listInventoryPage(ctx context.Context, db *sql.DB, kitchenID string, filters inventoryPageFilters, offset, limit int) (inventoryListPage, error) {
	var page inventoryListPage
	page.Offset = offset
	page.Limit = limit
	page.Items = []models.InventoryPageItem{}
	page.GroupCounts = map[string]int{}

	if err := queryInventoryBucketCounts(db, kitchenID, &page.Counts); err != nil {
		return page, err
	}

	bucketClause := inventoryBucketSQL(filters, 1)
	args := []interface{}{kitchenID}

	where, args := appendInventoryFilterClauses(bucketClause, args, filters, true)

	countQuery := "SELECT COUNT(*) FROM inventory WHERE " + where
	var total int
	if err := db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return page, err
	}
	page.Total = total
	page.HasMore = offset+limit < total

	groupQuery, groupArgs := inventoryGroupCountsQuery(kitchenID, filters)
	rows, err := db.QueryContext(ctx, groupQuery, groupArgs...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var fg string
		var n int
		if err := rows.Scan(&fg, &n); err != nil {
			return page, err
		}
		page.GroupCounts[inventoryGroupID(fg)] += n
	}
	if err := rows.Err(); err != nil {
		return page, err
	}

	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	listQuery := fmt.Sprintf(`
		SELECT
			item_id, canonical_name, qty, unit, food_group, ingredient_id, estimated_expiry, is_manual, created_at, updated_at,
			CASE
				WHEN estimated_expiry IS NULL THEN NULL
				ELSE (estimated_expiry - CURRENT_DATE)::int
			END AS days_until_expiry
		FROM inventory
		WHERE %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d
	`, where, inventoryOrderSQL(filters), limitArg, offsetArg)
	listArgs := append(append([]interface{}{}, args...), limit, offset)
	itemRows, err := db.QueryContext(ctx, listQuery, listArgs...)
	if err != nil {
		return page, err
	}
	defer itemRows.Close()

	items := make([]models.InventoryPageItem, 0, limit)
	for itemRows.Next() {
		item, err := scanInventoryPageItem(itemRows)
		if err != nil {
			return page, err
		}
		items = append(items, item)
	}
	if err := itemRows.Err(); err != nil {
		return page, err
	}
	enrichInventoryPageItems(items)
	page.Items = items
	return page, nil
}

func scanInventoryPageItem(rows interface {
	Scan(dest ...interface{}) error
}) (models.InventoryPageItem, error) {
	var item models.InventoryPageItem
	var expiry sql.NullTime
	var foodGroup sql.NullString
	var ingredientID sql.NullString
	var days sql.NullInt64
	err := rows.Scan(
		&item.ItemID,
		&item.CanonicalName,
		&item.Qty,
		&item.Unit,
		&foodGroup,
		&ingredientID,
		&expiry,
		&item.IsManual,
		&item.CreatedAt,
		&item.UpdatedAt,
		&days,
	)
	if err != nil {
		return item, err
	}
	if ingredientID.Valid {
		item.IngredientID = ingredientID.String
	}
	if foodGroup.Valid && foodGroup.String != "" {
		item.FoodGroup = foodGroup.String
	} else {
		item.FoodGroup = "other"
	}
	item.EstimatedExpiry = models.NullTime(expiry)
	if days.Valid {
		v := int(days.Int64)
		item.DaysUntilExpiry = &v
	}
	item.Unit = units.Normalize(item.Unit)
	return item, nil
}

func enrichInventoryPageItems(items []models.InventoryPageItem) {
	if len(items) == 0 {
		return
	}
	refs := make([]ingredients.PantryRef, 0, len(items))
	for _, item := range items {
		refs = append(refs, ingredients.PantryRef{IngredientID: item.IngredientID, Name: item.CanonicalName})
	}
	catalog := ingredients.NewBatchPantryCatalog(refs)
	for i := range items {
		d := catalog.DisplayFor(items[i].IngredientID, items[i].CanonicalName, items[i].FoodGroup, items[i].Qty, items[i].Unit)
		if d.IngredientID != "" {
			items[i].IngredientID = d.IngredientID
		}
		items[i].DisplayQty = d.DisplayQty
		items[i].Catalog = toItemCatalog(d.Catalog)
	}
}

package handlers

import (
	"strings"
	"testing"
)

func TestInventoryGroupCountsQueryRespectsBucketIgnoresSearchAndFoodGroup(t *testing.T) {
	filters := inventoryPageFilters{
		wantActive:   true,
		wantExpiring: true,
		q:            "rice",
		foodGroup:    "protein",
	}

	query, args := inventoryGroupCountsQuery("kitchen-123", filters)

	if len(args) != 1 {
		t.Fatalf("expected one query arg, got %d", len(args))
	}
	if args[0] != "kitchen-123" {
		t.Fatalf("expected kitchen id argument, got %v", args[0])
	}
	if !strings.Contains(query, "kitchen_id = $1") {
		t.Fatalf("expected query to scope by kitchen, got %q", query)
	}
	if !strings.Contains(query, "estimated_expiry IS NULL") {
		t.Fatalf("expected active bucket in group counts, got %q", query)
	}
	if !strings.Contains(query, "estimated_expiry <= CURRENT_DATE") {
		t.Fatalf("expected expiring bucket in group counts, got %q", query)
	}
	if strings.Contains(query, "ILIKE") {
		t.Fatalf("expected query to ignore search filter, got %q", query)
	}
	if strings.Contains(query, "IN ('non_veg', 'protein')") {
		t.Fatalf("expected query to ignore food group filter, got %q", query)
	}
}

func TestInventoryGroupCountsQueryExpiredBucketOnly(t *testing.T) {
	filters := inventoryPageFilters{
		wantExpired: true,
	}

	query, _ := inventoryGroupCountsQuery("kitchen-123", filters)

	if !strings.Contains(query, "estimated_expiry < CURRENT_DATE") {
		t.Fatalf("expected expired bucket in group counts, got %q", query)
	}
	if strings.Contains(query, "estimated_expiry IS NULL") {
		t.Fatalf("expected query to exclude active bucket, got %q", query)
	}
}

func TestInventoryGroupCountsQueryIgnoresExpiringOnly(t *testing.T) {
	filters := inventoryPageFilters{
		wantExpiring: true,
		expiringOnly: true,
	}

	query, _ := inventoryGroupCountsQuery("kitchen-123", filters)

	if !strings.Contains(query, "estimated_expiry IS NULL") {
		t.Fatalf("expected active bucket in group counts despite expiring_only, got %q", query)
	}
	if !strings.Contains(query, "estimated_expiry <= CURRENT_DATE") {
		t.Fatalf("expected expiring bucket in group counts despite expiring_only, got %q", query)
	}
}

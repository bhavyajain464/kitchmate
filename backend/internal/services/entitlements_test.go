package services

import (
	"database/sql"
	"testing"
	"time"
)

func TestCanBillScanFreeTier(t *testing.T) {
	ent := buildEntitlements(TierFree, "", nil, 2)
	if !ent.IsElite || ent.BillScanLimit != -1 {
		t.Fatal("launch promo should grant elite unlimited scans")
	}
	if ok, _ := CanBillScan(ent); !ok {
		t.Fatal("expected unlimited scans for all users")
	}
}

func TestEffectiveBillScansUsedResetsOnNewDay(t *testing.T) {
	loc, _ := time.LoadLocation(billScanTimezone)
	yesterday := time.Now().In(loc).AddDate(0, 0, -1)
	if got := effectiveBillScansUsed(5, sql.NullTime{Time: yesterday, Valid: true}); got != 0 {
		t.Fatalf("expected 0 scans after day change, got %d", got)
	}
	today := time.Now().In(loc)
	if got := effectiveBillScansUsed(2, sql.NullTime{Time: today, Valid: true}); got != 2 {
		t.Fatalf("expected 2 scans today, got %d", got)
	}
}

func TestCanUseMealCategory(t *testing.T) {
	free := buildEntitlements(TierFree, "", nil, 0)
	for _, cat := range []string{"daily", "meal_of_day", "rescue_meal", "most_tasty", "long_lasting"} {
		if ok, _ := CanUseMealCategory(free, cat); !ok {
			t.Fatalf("%s should be available on free tier", cat)
		}
	}
	if len(free.ProMealCategories) != 0 {
		t.Fatal("pro meal categories should be empty when suggestions are not tier-gated")
	}
}

func TestExpiredProStillGetsEliteLaunchPromo(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	ent := buildEntitlements(TierPro, IntervalMonthly, &past, 0)
	if ent.PlanTier != TierElite || !ent.IsPro || !ent.IsElite {
		t.Fatalf("launch promo should grant elite regardless of DB expiry, got tier=%s", ent.PlanTier)
	}
}

func TestEliteHasDietAnalysisFlag(t *testing.T) {
	future := time.Now().Add(30 * 24 * time.Hour)
	ent := buildEntitlements(TierElite, IntervalYearly, &future, 0)
	if !ent.IsElite || !ent.HasDietAnalysis {
		t.Fatal("elite should expose diet analysis flag")
	}
}

func TestExtendPlanExpiryStacks(t *testing.T) {
	base := time.Now().Add(10 * 24 * time.Hour)
	ext := ExtendPlanExpiry(&base, IntervalMonthly)
	if !ext.After(base) {
		t.Fatal("expected extension after current expiry")
	}
}

func TestProEntitlementsJSONFields(t *testing.T) {
	future := time.Now().Add(365 * 24 * time.Hour)
	ent := buildEntitlements(TierPro, IntervalYearly, &future, 0)
	if !ent.IsPro || !ent.IsElite {
		t.Fatal("expected is_pro and is_elite true during launch promo")
	}
	if ent.PlanTier != TierElite {
		t.Fatalf("expected plan_tier elite, got %s", ent.PlanTier)
	}
	if ent.BillScanLimit != -1 {
		t.Fatal("elite should have unlimited scans")
	}
}

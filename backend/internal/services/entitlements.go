package services

import (
	"database/sql"
	"strings"
	"time"
)

const (
	FreeBillScanLimit  = 2
	billScanTimezone   = "Asia/Kolkata"
	FreeMealCategory    = "daily"
	FreeMealOfDayCategory = "meal_of_day"
)

// FreeMealCategories are all smart-meal category ids (no plan gate).
var FreeMealCategories = []string{
	FreeMealCategory,
	FreeMealOfDayCategory,
	"today_plan",
	"rescue_meal",
	"most_healthy",
	"most_tasty",
	"long_lasting",
}

// ProMealCategories is kept for API compatibility; meal suggestions are not tier-gated.
var ProMealCategories = []string{}

// Entitlements describes what the user can access on their current plan.
type Entitlements struct {
	PlanTier           string         `json:"plan_tier"`
	PlanInterval       string         `json:"plan_interval,omitempty"`
	PlanExpiresAt      *time.Time     `json:"plan_expires_at,omitempty"`
	IsPro              bool           `json:"is_pro"`
	IsElite            bool           `json:"is_elite"`
	HasDietAnalysis    bool           `json:"has_diet_analysis"`
	BillScansUsed      int            `json:"bill_scans_used"`
	BillScanLimit      int            `json:"bill_scan_limit"`
	BillScansRemaining int            `json:"bill_scans_remaining"`
	FreeMealCategories []string       `json:"free_meal_categories"`
	ProMealCategories  []string       `json:"pro_meal_categories"`
	AvailablePlans     []PlanProduct  `json:"available_plans,omitempty"`
	UpgradeOptions     []UpgradeQuote `json:"upgrade_options,omitempty"`
}

// GetEntitlements loads plan and usage for a user.
func GetEntitlements(db *sql.DB, userID string) (Entitlements, error) {
	var tier string
	var interval sql.NullString
	var expires sql.NullTime
	var scans int
	var scanDate sql.NullTime
	var email string

	err := db.QueryRow(`
		SELECT COALESCE(plan_tier, 'free'), plan_interval, plan_expires_at,
		       COALESCE(bill_scan_count, 0), bill_scan_count_date,
		       COALESCE(email, '')
		FROM users WHERE user_id = $1
	`, userID).Scan(&tier, &interval, &expires, &scans, &scanDate, &email)
	if err != nil {
		return Entitlements{}, err
	}
	var expPtr *time.Time
	if expires.Valid {
		t := expires.Time
		expPtr = &t
	}
	var intervalStr string
	if interval.Valid {
		intervalStr = interval.String
	}
	tier, intervalStr, expPtr = applyComplimentaryPremium(email, tier, intervalStr, expPtr)
	return buildEntitlements(tier, intervalStr, expPtr, effectiveBillScansUsed(scans, scanDate)), nil
}

func billScanLocation() *time.Location {
	loc, err := time.LoadLocation(billScanTimezone)
	if err != nil {
		return time.UTC
	}
	return loc
}

func billScanDayKey(t time.Time) string {
	return t.In(billScanLocation()).Format("2006-01-02")
}

func billScanCalendarDate(now time.Time) time.Time {
	loc := billScanLocation()
	n := now.In(loc)
	y, m, d := n.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, loc)
}

// effectiveBillScansUsed returns today's scan count (resets when the calendar day changes in IST).
func effectiveBillScansUsed(count int, countDate sql.NullTime) int {
	if !countDate.Valid {
		return 0
	}
	if billScanDayKey(countDate.Time) != billScanDayKey(time.Now()) {
		return 0
	}
	return count
}

func buildEntitlements(tier, interval string, expiresAt *time.Time, scans int) Entitlements {
	_ = effectiveTier(NormalizeTier(tier), expiresAt)
	interval = NormalizeInterval(interval)

	// Launch promo: grant Elite entitlements to every user (runtime only; DB plan unchanged).
	tier = TierElite
	isPro := true
	isElite := true

	limit := FreeBillScanLimit
	remaining := limit - scans
	if isPro {
		limit = -1
		remaining = -1
	} else if remaining < 0 {
		remaining = 0
	}

	ent := Entitlements{
		PlanTier:           tier,
		PlanInterval:       interval,
		PlanExpiresAt:      expiresAt,
		IsPro:              isPro,
		IsElite:            isElite,
		HasDietAnalysis:    isElite,
		BillScansUsed:      scans,
		BillScanLimit:      limit,
		BillScansRemaining: remaining,
		FreeMealCategories: append([]string(nil), FreeMealCategories...),
		ProMealCategories:  append([]string(nil), ProMealCategories...),
		AvailablePlans:     PlanCatalog(),
	}
	ent.UpgradeOptions = BuildUpgradeOptions(ent)
	return ent
}

func effectiveTier(tier string, expiresAt *time.Time) string {
	if tier == TierFree {
		return TierFree
	}
	if expiresAt != nil && expiresAt.Before(time.Now()) {
		return TierFree
	}
	return tier
}

// CanBillScan reports whether another bill scan is allowed.
func CanBillScan(ent Entitlements) (bool, string) {
	if ent.IsPro {
		return true, ""
	}
	if ent.BillScansUsed >= FreeBillScanLimit {
		return false, "Free plan includes 2 bill scans per day. Upgrade to Pro for unlimited scanning."
	}
	return true, ""
}

// CanUseMealCategory reports whether the smart-meals category is allowed.
func CanUseMealCategory(_ Entitlements, category string) (bool, string) {
	if strings.TrimSpace(category) == "" {
		return true, ""
	}
	return true, ""
}

// CanUseDietAnalysis gates the upcoming elite feature.
func CanUseDietAnalysis(ent Entitlements) (bool, string) {
	if ent.HasDietAnalysis {
		return true, ""
	}
	if ent.IsPro {
		return false, "Diet analysis is part of Elite. Upgrade to Elite in Settings or on the Meals tab."
	}
	return false, "Diet analysis requires an Elite plan."
}

// ActivateSubscription sets tier, interval, and extends expiry after payment.
func ActivateSubscription(db *sql.DB, userID, tier, interval string) error {
	tier = NormalizeTier(tier)
	interval = NormalizeInterval(interval)
	if tier == TierFree || interval == "" {
		return nil
	}

	var currentTier string
	var currentExpires sql.NullTime
	err := db.QueryRow(`
		SELECT COALESCE(plan_tier, 'free'), plan_expires_at FROM users WHERE user_id = $1
	`, userID).Scan(&currentTier, &currentExpires)
	if err != nil {
		return err
	}
	var expPtr *time.Time
	if currentExpires.Valid {
		t := currentExpires.Time
		expPtr = &t
	}
	newTier := ResolveUpgradeTier(NormalizeTier(currentTier), tier)
	newExpires := ExtendPlanExpiry(expPtr, interval)

	_, err = db.Exec(`
		UPDATE users SET
			plan_tier = $2,
			plan_interval = $3,
			plan_expires_at = $4,
			plan = $2,
			updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1
	`, userID, newTier, interval, newExpires)
	return err
}

// RecordBillScan increments today's bill scan counter (resets at midnight IST).
func RecordBillScan(db *sql.DB, userID string) error {
	today := billScanCalendarDate(time.Now())
	_, err := db.Exec(`
		UPDATE users SET
			bill_scan_count = CASE
				WHEN bill_scan_count_date IS NULL OR bill_scan_count_date <> $2::date THEN 1
				ELSE bill_scan_count + 1
			END,
			bill_scan_count_date = $2::date,
			updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1
	`, userID, today)
	return err
}

package services

import (
	"fmt"
	"math"
	"strings"
)

// AnalysisStatus summarizes async enrichment progress for a day/week.
const (
	AnalysisStatusEmpty     = "empty"
	AnalysisStatusPending   = "pending"
	AnalysisStatusPartial   = "partial"
	AnalysisStatusReady     = "ready"
	AnalysisStatusFailed    = "failed"
	AnalysisStatusLegacyOnly = "legacy_only"
)

type microKey struct {
	Name string
	Unit string
}

// AggregateMealNutrition builds a DietDayReport from stored per-meal rows.
// dayCount is 1 for daily reports and 7 for weekly (used for micronutrient status thresholds).
func AggregateMealNutrition(dateLabel string, records []MealNutritionRecord, dayCount int) (
	report *DietDayReport,
	analysisStatus string,
	pendingCount int,
	failedCount int,
	completedCount int,
	legacyCount int,
) {
	if dayCount < 1 {
		dayCount = 1
	}
	for _, r := range records {
		switch strings.ToLower(strings.TrimSpace(r.Status)) {
		case NutritionStatusCompleted:
			completedCount++
		case NutritionStatusPending, NutritionStatusProcessing:
			pendingCount++
		case NutritionStatusFailed:
			failedCount++
		default:
			// No nutrition row (historical meal logged before this feature).
			legacyCount++
		}
	}

	switch {
	case len(records) == 0:
		analysisStatus = AnalysisStatusEmpty
		return nil, analysisStatus, 0, 0, 0, 0
	case completedCount == 0 && pendingCount > 0:
		analysisStatus = AnalysisStatusPending
		return nil, analysisStatus, pendingCount, failedCount, completedCount, legacyCount
	case completedCount == 0 && failedCount > 0 && pendingCount == 0:
		analysisStatus = AnalysisStatusFailed
		return nil, analysisStatus, pendingCount, failedCount, completedCount, legacyCount
	case completedCount == 0 && legacyCount > 0:
		analysisStatus = AnalysisStatusLegacyOnly
		return nil, analysisStatus, pendingCount, failedCount, completedCount, legacyCount
	case pendingCount > 0 || failedCount > 0:
		analysisStatus = AnalysisStatusPartial
	default:
		analysisStatus = AnalysisStatusReady
	}

	totals := DietMacroTotals{}
	meals := make([]DietMealBreakdown, 0, completedCount)
	microSums := map[microKey]float64{}

	for _, r := range records {
		if r.Status != NutritionStatusCompleted {
			continue
		}
		totals.CaloriesKcal += r.CaloriesKcal
		totals.ProteinG += r.ProteinG
		totals.CarbsG += r.CarbsG
		totals.FatG += r.FatG
		totals.FiberG += r.FiberG
		totals.SugarG += r.SugarG
		totals.SodiumMg += r.SodiumMg
		meals = append(meals, DietMealBreakdown{
			Name:         r.DishName,
			Slot:         r.MealSlot,
			CaloriesKcal: r.CaloriesKcal,
			ProteinG:     r.ProteinG,
			CarbsG:       r.CarbsG,
			FatG:         r.FatG,
		})
		for _, m := range r.Micronutrients {
			key := microKey{Name: normalizeMicroName(m.Name), Unit: strings.ToLower(strings.TrimSpace(m.Unit))}
			if key.Name == "" || key.Unit == "" {
				continue
			}
			microSums[key] += m.Amount
		}
	}

	split := DietMacroSplit{}
	p, c, f := totals.ProteinG*4, totals.CarbsG*4, totals.FatG*9
	sum := p + c + f
	if sum > 0 {
		split.Protein = p / sum * 100
		split.Carbs = c / sum * 100
		split.Fat = f / sum * 100
	}

	micros := make([]DietMicronutrient, 0, len(microSums))
	for key, amount := range microSums {
		status, note := micronutrientStatus(key.Name, amount, key.Unit, dayCount)
		micros = append(micros, DietMicronutrient{
			Name:   key.Name,
			Amount: formatMicroAmount(amount, key.Unit),
			Status: status,
			Note:   note,
		})
	}

	score := balanceScore(totals, dayCount)
	report = &DietDayReport{
		Date:           dateLabel,
		Summary:        buildAggregateSummary(totals, completedCount, dayCount, score),
		BalanceScore:   score,
		Totals:         roundTotals(totals),
		MacroSplitPct:  roundSplit(split),
		Meals:          meals,
		Micronutrients: micros,
		Highlights:     buildHighlights(totals, dayCount),
		Suggestions:    buildSuggestions(totals, dayCount),
		Disclaimer:     "Estimates are based on typical Indian home-cooked portions from meal names. Not medical advice.",
	}
	return report, analysisStatus, pendingCount, failedCount, completedCount, legacyCount
}

func normalizeMicroName(name string) string {
	n := strings.TrimSpace(name)
	if n == "" {
		return ""
	}
	lower := strings.ToLower(n)
	switch {
	case strings.Contains(lower, "vitamin c"), strings.Contains(lower, "ascorbic"):
		return "Vitamin C"
	case strings.Contains(lower, "vitamin d"):
		return "Vitamin D"
	case strings.Contains(lower, "b12"), strings.Contains(lower, "cobalamin"):
		return "Vitamin B12"
	case strings.Contains(lower, "iron"):
		return "Iron"
	case strings.Contains(lower, "calcium"):
		return "Calcium"
	case strings.Contains(lower, "potassium"):
		return "Potassium"
	case strings.Contains(lower, "magnesium"):
		return "Magnesium"
	case strings.Contains(lower, "zinc"):
		return "Zinc"
	case strings.Contains(lower, "folate"), strings.Contains(lower, "folic"):
		return "Folate"
	default:
		return strings.ToUpper(n[:1]) + n[1:]
	}
}

func micronutrientStatus(name string, amount float64, unit string, dayCount int) (string, string) {
	ref := dailyMicroRef(name, unit) * float64(dayCount)
	if ref <= 0 {
		return "adequate", "Estimated intake"
	}
	ratio := amount / ref
	switch {
	case ratio < 0.6:
		return "low", fmt.Sprintf("Below typical daily target (~%.0f%%)", ratio*100)
	case ratio > 1.8:
		return "high", fmt.Sprintf("Above typical daily target (~%.0f%%)", ratio*100)
	default:
		return "adequate", fmt.Sprintf("Near typical daily target (~%.0f%%)", ratio*100)
	}
}

func dailyMicroRef(name, unit string) float64 {
	n := strings.ToLower(name)
	u := strings.ToLower(unit)
	switch {
	case strings.Contains(n, "iron") && u == "mg":
		return 18
	case strings.Contains(n, "calcium") && u == "mg":
		return 1000
	case strings.Contains(n, "vitamin c") && u == "mg":
		return 75
	case strings.Contains(n, "vitamin d") && (u == "mcg" || u == "µg"):
		return 15
	case strings.Contains(n, "vitamin d") && u == "iu":
		return 600
	case strings.Contains(n, "potassium") && u == "mg":
		return 3400
	case strings.Contains(n, "magnesium") && u == "mg":
		return 320
	case strings.Contains(n, "zinc") && u == "mg":
		return 11
	case strings.Contains(n, "b12") && (u == "mcg" || u == "µg"):
		return 2.4
	case strings.Contains(n, "folate") && (u == "mcg" || u == "µg"):
		return 400
	default:
		return 0
	}
}

func formatMicroAmount(amount float64, unit string) string {
	if amount >= 100 {
		return fmt.Sprintf("%.0f %s", amount, unit)
	}
	if amount >= 10 {
		return fmt.Sprintf("%.1f %s", amount, unit)
	}
	return fmt.Sprintf("%.2f %s", amount, unit)
}

func balanceScore(t DietMacroTotals, dayCount int) int {
	calTarget := 2000.0 * float64(dayCount)
	protTarget := 60.0 * float64(dayCount)
	fiberTarget := 25.0 * float64(dayCount)
	sodiumLimit := 2300.0 * float64(dayCount)

	score := 70.0
	if calTarget > 0 {
		diff := math.Abs(t.CaloriesKcal-calTarget) / calTarget
		score -= math.Min(25, diff*40)
	}
	if t.ProteinG < protTarget*0.7 {
		score -= 10
	} else if t.ProteinG >= protTarget {
		score += 5
	}
	if t.FiberG < fiberTarget*0.6 {
		score -= 8
	} else if t.FiberG >= fiberTarget {
		score += 5
	}
	if t.SodiumMg > sodiumLimit {
		score -= 10
	}
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return int(math.Round(score))
}

func buildAggregateSummary(t DietMacroTotals, mealCount, dayCount, score int) string {
	period := "day"
	if dayCount > 1 {
		period = "week"
	}
	return fmt.Sprintf(
		"Across %d analyzed meal(s) this %s, estimated intake is about %.0f kcal with %.0fg protein, %.0fg carbs, and %.0fg fat. Balance score %d/100.",
		mealCount, period, t.CaloriesKcal, t.ProteinG, t.CarbsG, t.FatG, score,
	)
}

func buildHighlights(t DietMacroTotals, dayCount int) []string {
	var out []string
	protTarget := 60.0 * float64(dayCount)
	fiberTarget := 25.0 * float64(dayCount)
	if t.ProteinG >= protTarget {
		out = append(out, "Protein intake looks solid for this period.")
	}
	if t.FiberG >= fiberTarget*0.8 {
		out = append(out, "Fiber is in a helpful range for digestion.")
	}
	if t.CaloriesKcal > 0 {
		out = append(out, "Meal logging gave enough data to estimate daily totals.")
	}
	if len(out) == 0 {
		out = append(out, "Keep logging meals to improve nutrient tracking.")
	}
	return out
}

func buildSuggestions(t DietMacroTotals, dayCount int) []string {
	var out []string
	protTarget := 60.0 * float64(dayCount)
	fiberTarget := 25.0 * float64(dayCount)
	sodiumLimit := 2300.0 * float64(dayCount)
	if t.ProteinG < protTarget*0.8 {
		out = append(out, "Add a dal, curd, paneer, egg, or lean protein side.")
	}
	if t.FiberG < fiberTarget*0.7 {
		out = append(out, "Include a salad, fruit, or whole-grain roti for more fiber.")
	}
	if t.SodiumMg > sodiumLimit {
		out = append(out, "Cut back on fried/packaged snacks and salty pickles tomorrow.")
	}
	if len(out) == 0 {
		out = append(out, "Keep portions steady and add a colorful vegetable dish.")
	}
	return out
}

func roundTotals(t DietMacroTotals) DietMacroTotals {
	return DietMacroTotals{
		CaloriesKcal: math.Round(t.CaloriesKcal),
		ProteinG:     math.Round(t.ProteinG*10) / 10,
		CarbsG:       math.Round(t.CarbsG*10) / 10,
		FatG:         math.Round(t.FatG*10) / 10,
		FiberG:       math.Round(t.FiberG*10) / 10,
		SugarG:       math.Round(t.SugarG*10) / 10,
		SodiumMg:     math.Round(t.SodiumMg),
	}
}

func roundSplit(s DietMacroSplit) DietMacroSplit {
	return DietMacroSplit{
		Protein: math.Round(s.Protein*10) / 10,
		Carbs:   math.Round(s.Carbs*10) / 10,
		Fat:     math.Round(s.Fat*10) / 10,
	}
}

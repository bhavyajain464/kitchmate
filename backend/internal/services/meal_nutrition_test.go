package services

import "testing"

func TestParseMealNutritionJSON(t *testing.T) {
	raw := `{"calories_kcal":450,"protein_g":18,"carbs_g":55,"fat_g":14,"fiber_g":6,"sugar_g":4,"sodium_mg":600,"micronutrients":[{"name":"Iron","amount":3.2,"unit":"mg"},{"name":"Calcium","amount":120,"unit":"mg"}]}`
	est, err := parseMealNutritionJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if est.CaloriesKcal != 450 || est.ProteinG != 18 {
		t.Fatalf("unexpected macros: %+v", est)
	}
	if len(est.Micronutrients) != 2 {
		t.Fatalf("micros=%d", len(est.Micronutrients))
	}
}

func TestAggregateMealNutritionPending(t *testing.T) {
	records := []MealNutritionRecord{
		{CookedLogID: "1", Status: NutritionStatusPending, DishName: "dal"},
		{CookedLogID: "2", Status: NutritionStatusPending, DishName: "rice"},
	}
	report, status, pending, failed, completed, _ := AggregateMealNutrition("2026-07-21", records, 1)
	if report != nil || status != AnalysisStatusPending || pending != 2 || failed != 0 || completed != 0 {
		t.Fatalf("report=%v status=%s pending=%d failed=%d completed=%d", report, status, pending, failed, completed)
	}
}

func TestAggregateMealNutritionReady(t *testing.T) {
	records := []MealNutritionRecord{
		{
			CookedLogID: "1", Status: NutritionStatusCompleted, DishName: "dal rice", MealSlot: "lunch",
			CaloriesKcal: 500, ProteinG: 20, CarbsG: 70, FatG: 12, FiberG: 8, SugarG: 3, SodiumMg: 400,
			Micronutrients: []MealMicronutrientAmount{{Name: "Iron", Amount: 4, Unit: "mg"}},
		},
		{
			CookedLogID: "2", Status: NutritionStatusCompleted, DishName: "curd", MealSlot: "dinner",
			CaloriesKcal: 150, ProteinG: 8, CarbsG: 10, FatG: 6, FiberG: 0, SugarG: 8, SodiumMg: 80,
			Micronutrients: []MealMicronutrientAmount{{Name: "Iron", Amount: 1, Unit: "mg"}, {Name: "Calcium", Amount: 200, Unit: "mg"}},
		},
	}
	report, status, pending, failed, completed, _ := AggregateMealNutrition("2026-07-21", records, 1)
	if status != AnalysisStatusReady || pending != 0 || failed != 0 || completed != 2 {
		t.Fatalf("status=%s pending=%d failed=%d completed=%d", status, pending, failed, completed)
	}
	if report == nil {
		t.Fatal("expected report")
	}
	if report.Totals.CaloriesKcal != 650 {
		t.Fatalf("calories=%v", report.Totals.CaloriesKcal)
	}
	if len(report.Meals) != 2 {
		t.Fatalf("meals=%d", len(report.Meals))
	}
	var ironFound bool
	for _, m := range report.Micronutrients {
		if m.Name == "Iron" {
			ironFound = true
			if m.Amount != "5.00 mg" {
				t.Fatalf("iron amount=%q", m.Amount)
			}
		}
	}
	if !ironFound {
		t.Fatal("expected iron micronutrient")
	}
	if report.BalanceScore <= 0 || report.Summary == "" {
		t.Fatalf("score=%d summary=%q", report.BalanceScore, report.Summary)
	}
}

func TestIsEatenLogSourceFiltersDrafts(t *testing.T) {
	if IsEatenLogSource(CookedSourceCookSent) {
		t.Fatal("cook-sent should not be eaten")
	}
	if !IsEatenLogSource("manual") {
		t.Fatal("manual should be eaten")
	}
	if !IsEatenLogSource("whatsapp-parsed") {
		t.Fatal("whatsapp-parsed should be eaten")
	}
}

func TestNormalizeMealNutritionEstimateClampsNegatives(t *testing.T) {
	est := &MealNutritionEstimate{
		CaloriesKcal: -10,
		ProteinG:     5,
		Micronutrients: []MealMicronutrientAmount{
			{Name: "Iron", Amount: -1, Unit: "mg"},
			{Name: "Calcium", Amount: 10, Unit: "mg"},
		},
	}
	normalizeMealNutritionEstimate(est)
	if est.CaloriesKcal != 0 {
		t.Fatalf("calories=%v", est.CaloriesKcal)
	}
	if len(est.Micronutrients) != 1 || est.Micronutrients[0].Name != "Calcium" {
		t.Fatalf("micros=%+v", est.Micronutrients)
	}
}

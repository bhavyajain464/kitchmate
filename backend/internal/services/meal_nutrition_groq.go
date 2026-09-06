package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"kitchenai-backend/pkg/config"
)

const groqMaxTokensMealNutrition = 900

const mealNutritionSystemPrompt = `You are a registered-dietitian-style assistant for Indian home cooking.
Estimate nutrition for ONE meal from its name, slot, and portions (home-cooked, not restaurant mega-plates).
Respond with ONE JSON object only — no markdown fences, no commentary.
All numeric fields must be numbers (not strings). Totals must already include the given portions.`

// MealNutritionEstimate is Groq output for a single meal.
type MealNutritionEstimate struct {
	CaloriesKcal   float64                    `json:"calories_kcal"`
	ProteinG       float64                    `json:"protein_g"`
	CarbsG         float64                    `json:"carbs_g"`
	FatG           float64                    `json:"fat_g"`
	FiberG         float64                    `json:"fiber_g"`
	SugarG         float64                    `json:"sugar_g"`
	SodiumMg       float64                    `json:"sodium_mg"`
	Micronutrients []MealMicronutrientAmount   `json:"micronutrients"`
}

// GroqMealNutrition analyzes one cooked meal asynchronously.
func GroqMealNutrition(ctx context.Context, cfg *config.Config, entry *CookedLogEntry, prefs *UserPrefsData) (*MealNutritionEstimate, string, error) {
	if cfg == nil || !cfg.HasGroqAPIKey() {
		return nil, "", fmt.Errorf("GROQ_API_KEY is not configured")
	}
	if entry == nil {
		return nil, "", fmt.Errorf("cooked log entry required")
	}
	model := cfg.EffectiveGroqModel()
	prompt := buildMealNutritionPrompt(entry, prefs)
	text, err := groqChat(ctx, cfg.PickGroqAPIKey(), model, 0.2, groqMaxTokensMealNutrition, []groqMessage{
		{Role: "system", Content: mealNutritionSystemPrompt},
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, model, err
	}
	est, err := parseMealNutritionJSON(text)
	if err != nil {
		return nil, model, err
	}
	normalizeMealNutritionEstimate(est)
	return est, model, nil
}

func buildMealNutritionPrompt(entry *CookedLogEntry, prefs *UserPrefsData) string {
	var b strings.Builder
	slot := strings.TrimSpace(entry.MealSlot)
	if slot == "" {
		slot = "unspecified"
	}
	portions := entry.Portions
	if portions <= 0 {
		portions = 1
	}
	b.WriteString(fmt.Sprintf("Analyze this single meal eaten on %s.\n", entry.CookedOn))
	b.WriteString(fmt.Sprintf("Dish: %s\nSlot: %s\nPortions: %.1f\n", entry.DishName, slot, portions))
	if strings.TrimSpace(entry.Notes) != "" {
		b.WriteString("Notes: " + strings.TrimSpace(entry.Notes) + "\n")
	}
	if prefs != nil {
		if len(prefs.DietaryTags) > 0 {
			b.WriteString("Dietary tags: " + strings.Join(prefs.DietaryTags, ", ") + "\n")
		}
		if len(prefs.Allergies) > 0 {
			b.WriteString("Allergies: " + strings.Join(prefs.Allergies, ", ") + "\n")
		}
	}
	b.WriteString(`
Return JSON matching this schema:
{
  "calories_kcal": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "fiber_g": number,
  "sugar_g": number,
  "sodium_mg": number,
  "micronutrients": [
    { "name": "Iron", "amount": 2.5, "unit": "mg" }
  ]
}
Include at least 8 micronutrients with numeric amount and unit (mg, mcg, IU, or g).
Totals MUST already reflect the portions value above.`)
	return b.String()
}

func parseMealNutritionJSON(text string) (*MealNutritionEstimate, error) {
	cleaned := strings.TrimSpace(text)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)

	var est MealNutritionEstimate
	if err := json.Unmarshal([]byte(cleaned), &est); err == nil {
		return &est, nil
	}
	re := regexp.MustCompile(`\{[\s\S]*\}`)
	if m := re.FindString(cleaned); m != "" {
		if err := json.Unmarshal([]byte(m), &est); err == nil {
			return &est, nil
		}
	}
	return nil, fmt.Errorf("could not parse meal nutrition JSON from model")
}

func normalizeMealNutritionEstimate(est *MealNutritionEstimate) {
	if est == nil {
		return
	}
	if est.CaloriesKcal < 0 {
		est.CaloriesKcal = 0
	}
	if est.ProteinG < 0 {
		est.ProteinG = 0
	}
	if est.CarbsG < 0 {
		est.CarbsG = 0
	}
	if est.FatG < 0 {
		est.FatG = 0
	}
	if est.FiberG < 0 {
		est.FiberG = 0
	}
	if est.SugarG < 0 {
		est.SugarG = 0
	}
	if est.SodiumMg < 0 {
		est.SodiumMg = 0
	}
	out := make([]MealMicronutrientAmount, 0, len(est.Micronutrients))
	for _, m := range est.Micronutrients {
		name := strings.TrimSpace(m.Name)
		unit := strings.ToLower(strings.TrimSpace(m.Unit))
		if name == "" || m.Amount < 0 {
			continue
		}
		if unit == "" {
			unit = "mg"
		}
		out = append(out, MealMicronutrientAmount{Name: name, Amount: m.Amount, Unit: unit})
	}
	est.Micronutrients = out
}

func (e *MealNutritionEstimate) Totals() DietMacroTotals {
	if e == nil {
		return DietMacroTotals{}
	}
	return DietMacroTotals{
		CaloriesKcal: e.CaloriesKcal,
		ProteinG:     e.ProteinG,
		CarbsG:       e.CarbsG,
		FatG:         e.FatG,
		FiberG:       e.FiberG,
		SugarG:       e.SugarG,
		SodiumMg:     e.SodiumMg,
	}
}

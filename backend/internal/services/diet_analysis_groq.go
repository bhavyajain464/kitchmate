package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"kitchenai-backend/pkg/config"
)

const groqMaxTokensDiet = 3200

const dietAnalysisSystemPrompt = `You are a registered-dietitian-style assistant for Indian home cooking.
Estimate nutrition from meal names and typical portions (not restaurant mega-plates).
Respond with ONE JSON object only — no markdown fences, no commentary.
All numeric fields must be numbers (not strings). Use reasonable daily totals when multiple meals are listed.`

// GroqDietWeekReport builds a structured weekly report from logged meals.
func GroqDietWeekReport(ctx context.Context, cfg *config.Config, startISO, endISO string, entries []CookedLogEntry, prefs *UserPrefsData, displayName string) (*DietDayReport, error) {
	if cfg == nil || !cfg.HasGroqAPIKey() {
		return nil, fmt.Errorf("GROQ_API_KEY is not configured")
	}
	model := cfg.EffectiveGroqModel()
	prompt := buildDietWeekAnalysisPrompt(startISO, endISO, entries, prefs, displayName)
	text, err := groqChat(ctx, cfg.PickGroqAPIKey(), model, 0.2, groqMaxTokensDiet, []groqMessage{
		{Role: "system", Content: dietAnalysisSystemPrompt},
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, err
	}
	report, err := parseDietDayReportJSON(text)
	if err != nil {
		return nil, err
	}
	report.Date = startISO + " to " + endISO
	normalizeDietDayReport(report, entries)
	return report, nil
}

// GroqDietDayReport builds a structured day report from logged meals.
func GroqDietDayReport(ctx context.Context, cfg *config.Config, dateISO string, entries []CookedLogEntry, prefs *UserPrefsData, displayName string) (*DietDayReport, error) {
	if cfg == nil || !cfg.HasGroqAPIKey() {
		return nil, fmt.Errorf("GROQ_API_KEY is not configured")
	}
	model := cfg.EffectiveGroqModel()
	prompt := buildDietAnalysisPrompt(dateISO, entries, prefs, displayName)
	text, err := groqChat(ctx, cfg.PickGroqAPIKey(), model, 0.2, groqMaxTokensDiet, []groqMessage{
		{Role: "system", Content: dietAnalysisSystemPrompt},
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, err
	}
	report, err := parseDietDayReportJSON(text)
	if err != nil {
		return nil, err
	}
	report.Date = dateISO
	normalizeDietDayReport(report, entries)
	return report, nil
}

func buildDietWeekAnalysisPrompt(startISO, endISO string, entries []CookedLogEntry, prefs *UserPrefsData, displayName string) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("Analyze all meals eaten during the week from %s to %s (7 days)", startISO, endISO))
	if displayName != "" {
		b.WriteString(fmt.Sprintf(" for %s", displayName))
	}
	b.WriteString(".\n\nProvide WEEKLY totals (sum across the week), not single-day averages.\n\nLogged meals:\n")
	for i, e := range entries {
		slot := e.MealSlot
		if slot == "" {
			slot = "unspecified"
		}
		line := fmt.Sprintf("%d. %s — %s (%s)", i+1, e.CookedOn, e.DishName, slot)
		if e.Notes != "" {
			line += " — " + e.Notes
		}
		if e.Portions > 0 {
			line += fmt.Sprintf(" — portions: %.1f", e.Portions)
		}
		b.WriteString(line + "\n")
	}
	if prefs != nil {
		if len(prefs.DietaryTags) > 0 {
			b.WriteString("\nDietary tags: " + strings.Join(prefs.DietaryTags, ", "))
		}
		if len(prefs.Allergies) > 0 {
			b.WriteString("\nAllergies: " + strings.Join(prefs.Allergies, ", "))
		}
		if len(prefs.Dislikes) > 0 {
			b.WriteString("\nDislikes: " + strings.Join(prefs.Dislikes, ", "))
		}
	}
	b.WriteString(`

Return JSON matching this schema:
{
  "date": "YYYY-MM-DD to YYYY-MM-DD",
  "summary": "2-4 sentence overview of the week's nutrition",
  "balance_score": 0-100,
  "totals": {
    "calories_kcal": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "fiber_g": number,
    "sugar_g": number,
    "sodium_mg": number
  },
  "macro_split_pct": { "protein": number, "carbs": number, "fat": number },
  "meals": [
    {
      "name": "dish name",
      "slot": "breakfast|lunch|dinner|snack",
      "calories_kcal": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number
    }
  ],
  "micronutrients": [
    { "name": "Iron", "amount": "estimated", "status": "low|adequate|high", "note": "brief" }
  ],
  "highlights": ["3-5 bullets on what went well this week"],
  "suggestions": ["3-5 actionable tips for next week"],
  "disclaimer": "Estimates from meal names; not medical advice."
}
Include at least 8 micronutrients (e.g. iron, calcium, vitamin C, vitamin D, potassium, magnesium, zinc, B12).
macro_split_pct should sum to ~100 (energy from protein/carbs/fat).`)
	return b.String()
}

func buildDietAnalysisPrompt(dateISO string, entries []CookedLogEntry, prefs *UserPrefsData, displayName string) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("Analyze meals eaten on %s", dateISO))
	if displayName != "" {
		b.WriteString(fmt.Sprintf(" for %s", displayName))
	}
	b.WriteString(".\n\nLogged meals:\n")
	for i, e := range entries {
		slot := e.MealSlot
		if slot == "" {
			slot = "unspecified"
		}
		line := fmt.Sprintf("%d. %s (%s)", i+1, e.DishName, slot)
		if e.Notes != "" {
			line += " — " + e.Notes
		}
		if e.Portions > 0 {
			line += fmt.Sprintf(" — portions: %.1f", e.Portions)
		}
		b.WriteString(line + "\n")
	}
	if prefs != nil {
		if len(prefs.DietaryTags) > 0 {
			b.WriteString("\nDietary tags: " + strings.Join(prefs.DietaryTags, ", "))
		}
		if len(prefs.Allergies) > 0 {
			b.WriteString("\nAllergies: " + strings.Join(prefs.Allergies, ", "))
		}
		if len(prefs.Dislikes) > 0 {
			b.WriteString("\nDislikes: " + strings.Join(prefs.Dislikes, ", "))
		}
	}
	b.WriteString(`

Return JSON matching this schema:
{
  "date": "YYYY-MM-DD",
  "summary": "2-4 sentence overview of the day's nutrition",
  "balance_score": 0-100,
  "totals": {
    "calories_kcal": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "fiber_g": number,
    "sugar_g": number,
    "sodium_mg": number
  },
  "macro_split_pct": { "protein": number, "carbs": number, "fat": number },
  "meals": [
    {
      "name": "dish name",
      "slot": "breakfast|lunch|dinner|snack",
      "calories_kcal": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number
    }
  ],
  "micronutrients": [
    { "name": "Iron", "amount": "estimated", "status": "low|adequate|high", "note": "brief" }
  ],
  "highlights": ["3-5 bullets on what went well"],
  "suggestions": ["3-5 actionable tips for tomorrow"],
  "disclaimer": "Estimates from meal names; not medical advice."
}
Include at least 8 micronutrients (e.g. iron, calcium, vitamin C, vitamin D, potassium, magnesium, zinc, B12).
macro_split_pct should sum to ~100 (energy from protein/carbs/fat).`)
	return b.String()
}

func parseDietDayReportJSON(text string) (*DietDayReport, error) {
	cleaned := strings.TrimSpace(text)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)

	var report DietDayReport
	if err := json.Unmarshal([]byte(cleaned), &report); err == nil {
		return &report, nil
	}
	re := regexp.MustCompile(`\{[\s\S]*\}`)
	if m := re.FindString(cleaned); m != "" {
		if err := json.Unmarshal([]byte(m), &report); err == nil {
			return &report, nil
		}
	}
	return nil, fmt.Errorf("could not parse diet analysis JSON from model")
}

func normalizeDietDayReport(r *DietDayReport, entries []CookedLogEntry) {
	if r == nil {
		return
	}
	if r.Disclaimer == "" {
		r.Disclaimer = "Estimates are based on typical Indian home-cooked portions from meal names. Not medical advice."
	}
	if len(r.Meals) == 0 && len(entries) > 0 {
		for _, e := range entries {
			r.Meals = append(r.Meals, DietMealBreakdown{
				Name: e.DishName,
				Slot: e.MealSlot,
			})
		}
	}
	if r.MacroSplitPct.Protein+r.MacroSplitPct.Carbs+r.MacroSplitPct.Fat < 1 {
		p, c, f := r.Totals.ProteinG*4, r.Totals.CarbsG*4, r.Totals.FatG*9
		sum := p + c + f
		if sum > 0 {
			r.MacroSplitPct.Protein = p / sum * 100
			r.MacroSplitPct.Carbs = c / sum * 100
			r.MacroSplitPct.Fat = f / sum * 100
		}
	}
}

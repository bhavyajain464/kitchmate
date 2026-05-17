package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"

	"kitchenai-backend/pkg/config"
)

// WhatsAppParseIntent classifies a forwarded WhatsApp message from cook or family.
type WhatsAppParseIntent string

const (
	IntentAddShopping      WhatsAppParseIntent = "add_to_shopping_list"
	IntentMarkOutOfStock   WhatsAppParseIntent = "mark_out_of_stock"
	IntentAddInventory     WhatsAppParseIntent = "add_inventory"
	IntentNoteDislike      WhatsAppParseIntent = "note_dislike"
	IntentReportCookedDish WhatsAppParseIntent = "report_cooked_dish"
	IntentUnknown          WhatsAppParseIntent = "unknown"
)

// WhatsAppParsedAction is the structured output from the NLU step.
type WhatsAppParsedAction struct {
	Intent     WhatsAppParseIntent `json:"intent"`
	Confidence float64             `json:"confidence"`
	Summary    string              `json:"summary"`
	Entities   WhatsAppEntities    `json:"entities"`
}

// WhatsAppEntities holds extracted fields (only relevant ones are set per intent).
type WhatsAppEntities struct {
	ItemName string  `json:"item_name,omitempty"`
	Qty      float64 `json:"qty,omitempty"`
	Unit     string  `json:"unit,omitempty"`
	DishName string  `json:"dish_name,omitempty"`
	MealSlot string  `json:"meal_slot,omitempty"`
	Note     string  `json:"note,omitempty"`
}

var whatsappObjectPattern = regexp.MustCompile(`\{[^{}]*"intent"\s*:\s*"[^"]+"[^{}]*\}`)

const maxWhatsAppMessageLen = 2000

// UnknownWhatsAppAction is returned when NLU cannot classify the message.
func UnknownWhatsAppAction(reason string) *WhatsAppParsedAction {
	summary := strings.TrimSpace(reason)
	if summary == "" {
		summary = "Could not understand this message."
	}
	a := &WhatsAppParsedAction{
		Intent:     IntentUnknown,
		Confidence: 0.2,
		Summary:    summary,
	}
	normalizeWhatsAppAction(a)
	return a
}

// ParseWhatsAppMessage uses Groq NLU model to classify kitchen messages.
func ParseWhatsAppMessage(ctx context.Context, cfg *config.Config, rawText string) (*WhatsAppParsedAction, error) {
	rawText = strings.TrimSpace(rawText)
	if rawText == "" {
		return nil, fmt.Errorf("message text is empty")
	}
	if len(rawText) > maxWhatsAppMessageLen {
		rawText = rawText[:maxWhatsAppMessageLen]
	}
	if cfg.GroqAPIKey == "" {
		return UnknownWhatsAppAction("AI parsing is not configured on the server."), nil
	}

	model := strings.TrimSpace(cfg.GroqNLUModel)
	if model == "" {
		model = "llama-3.1-8b-instant"
	}

	prompt := fmt.Sprintf(`Message (EN/HI/Hinglish/Kannada):
"""
%s
"""

Intents: add_to_shopping_list | mark_out_of_stock | add_inventory | note_dislike | report_cooked_dish | unknown
Entities: item_name (English grocery), qty (default 1), unit (default pcs), dish_name, meal_slot, note (short English summary)

JSON only:
{"intent":"...","confidence":0.9,"summary":"...","entities":{}}`, rawText)

	text, err := GroqChatNLU(ctx, cfg.GroqAPIKey, model, prompt)
	if err != nil {
		log.Printf("[whatsapp-parse] groq failed: %v", err)
		return UnknownWhatsAppAction(""), nil
	}

	action, err := parseWhatsAppActionJSON(text)
	if err != nil {
		log.Printf("[whatsapp-parse] parse failed: %v raw=%q", err, truncate(text, 200))
		return UnknownWhatsAppAction("Could not understand this message."), nil
	}
	normalizeWhatsAppAction(action)
	return action, nil
}

func parseWhatsAppActionJSON(responseText string) (*WhatsAppParsedAction, error) {
	cleaned := strings.TrimSpace(responseText)
	if strings.HasPrefix(cleaned, "```json") {
		cleaned = strings.TrimPrefix(cleaned, "```json")
	}
	if strings.HasPrefix(cleaned, "```") {
		cleaned = strings.TrimPrefix(cleaned, "```")
	}
	if strings.HasSuffix(cleaned, "```") {
		cleaned = strings.TrimSuffix(cleaned, "```")
	}
	cleaned = strings.TrimSpace(cleaned)

	var action WhatsAppParsedAction
	if err := json.Unmarshal([]byte(cleaned), &action); err == nil {
		return &action, nil
	}

	if start, end := strings.Index(cleaned, "{"), strings.LastIndex(cleaned, "}"); start != -1 && end > start {
		if err := json.Unmarshal([]byte(cleaned[start:end+1]), &action); err == nil {
			return &action, nil
		}
	}

	m := whatsappObjectPattern.FindString(cleaned)
	if m != "" {
		if err := json.Unmarshal([]byte(m), &action); err == nil {
			return &action, nil
		}
	}

	return nil, fmt.Errorf("no valid JSON object in response")
}

func normalizeWhatsAppAction(a *WhatsAppParsedAction) {
	a.Intent = WhatsAppParseIntent(strings.TrimSpace(string(a.Intent)))
	if a.Confidence <= 0 || a.Confidence > 1 {
		if a.Intent == IntentUnknown {
			a.Confidence = 0.3
		} else {
			a.Confidence = 0.75
		}
	}
	a.Summary = strings.TrimSpace(a.Summary)
	a.Entities.ItemName = strings.TrimSpace(a.Entities.ItemName)
	a.Entities.Unit = strings.TrimSpace(a.Entities.Unit)
	if a.Entities.Qty <= 0 {
		a.Entities.Qty = 1
	}
	if a.Entities.Unit == "" {
		a.Entities.Unit = "pcs"
	}
	switch a.Intent {
	case IntentAddShopping, IntentMarkOutOfStock, IntentAddInventory, IntentNoteDislike, IntentReportCookedDish:
		// ok
	default:
		a.Intent = IntentUnknown
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

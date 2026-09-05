package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"

	"kitchenai-backend/pkg/config"
	"kitchenai-backend/pkg/units"
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
var whatsappActionsArrayPattern = regexp.MustCompile(`"actions"\s*:\s*\[[\s\S]*?\]`)
var whatsappReplyFieldPattern = regexp.MustCompile(`"reply"\s*:\s*"((?:\\.|[^"\\])*)"`)
var whatsappIntentFieldPattern = regexp.MustCompile(`"intent"\s*:\s*"([^"]+)"`)
var whatsappItemNameFieldPattern = regexp.MustCompile(`"item_name"\s*:\s*"([^"]+)"`)
var buddyReplyItemPattern = regexp.MustCompile(`(?i)add(?:ing)?\s+([a-zA-Z][a-zA-Z0-9-]*)\s*(?:\(|\.|,|to your|$)`)

const maxWhatsAppMessageLen = 2000
const maxWhatsAppActionsPerMessage = 8
const maxWhatsAppHistoryTurns = 10

// WhatsAppChatTurn is one message in an in-app buddy conversation.
type WhatsAppChatTurn struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

// WhatsAppParseResult is NLU output plus a conversational reply for the chat UI.
type WhatsAppParseResult struct {
	Reply   string
	Actions []*WhatsAppParsedAction
}

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

// ParseWhatsAppMessage uses Groq NLU model to classify kitchen messages (first action only).
func ParseWhatsAppMessage(ctx context.Context, cfg *config.Config, rawText string) (*WhatsAppParsedAction, error) {
	result, err := ParseWhatsAppMessages(ctx, cfg, rawText, nil)
	if err != nil {
		return nil, err
	}
	if len(result.Actions) == 0 {
		return UnknownWhatsAppAction(""), nil
	}
	return result.Actions[0], nil
}

// ParseWhatsAppMessages extracts tasks and a conversational reply from one chat turn.
func ParseWhatsAppMessages(ctx context.Context, cfg *config.Config, rawText string, history []WhatsAppChatTurn) (*WhatsAppParseResult, error) {
	rawText = strings.TrimSpace(rawText)
	if rawText == "" {
		return nil, fmt.Errorf("message text is empty")
	}
	if len(rawText) > maxWhatsAppMessageLen {
		rawText = rawText[:maxWhatsAppMessageLen]
	}
	if !cfg.HasGroqAPIKey() {
		return &WhatsAppParseResult{
			Reply:   "I'm not fully set up on the server yet. Try again in a bit.",
			Actions: []*WhatsAppParsedAction{UnknownWhatsAppAction("AI parsing is not configured on the server.")},
		}, nil
	}

	model := cfg.EffectiveGroqModel()
	historyBlock := formatWhatsAppHistory(history)

	prompt := fmt.Sprintf(`You are Rasoi Buddy — a warm, concise kitchen assistant in an in-app chat (EN/HI/Hinglish/Kannada).

%sLatest user message:
"""
%s
"""

Your job:
1. Write a short, natural "reply" (1–3 sentences) as the buddy. Be friendly, not robotic. No JSON in reply.
2. Extract kitchen tasks only when the user wants something done. Corrections like "no I meant X" should use chat history — do not return unknown for casual chat.
3. Chit-chat, greetings, thanks, or clarifications → reply helpfully and return "actions": [].
4. When tasks are found, reply should summarize what you'll do and ask them to confirm.

Task intents: add_to_shopping_list | mark_out_of_stock | add_inventory | note_dislike | report_cooked_dish
Do NOT use "unknown" in actions — omit unclear parts and explain in reply instead.

Entities per task: item_name (English grocery), qty (default 1), unit (default pcs), dish_name, meal_slot (breakfast|lunch|dinner|snack), note (short English)

Examples:
- "milk khatam, shopping list mein daal do" → reply + add milk to shopping
- "no I meant curd not milk" (after milk was discussed) → reply acknowledging correction + correct action
- "thanks!" → friendly reply, actions: []

Return JSON only (up to %d actions):
{"reply":"...","actions":[{"intent":"...","confidence":0.9,"summary":"...","entities":{}}]}`, historyBlock, rawText, maxWhatsAppActionsPerMessage)

	text, err := GroqChatNLU(ctx, cfg.PickGroqAPIKey(), model, prompt)
	if err != nil {
		log.Printf("[whatsapp-parse] groq failed: %v", err)
		return &WhatsAppParseResult{
			Reply:   "I had trouble understanding that. Could you say it once more?",
			Actions: []*WhatsAppParsedAction{},
		}, nil
	}

	reply, actions, err := parseWhatsAppChatJSON(text)
	if err != nil || (len(actions) == 0 && strings.TrimSpace(reply) == "") {
		log.Printf("[whatsapp-parse] parse failed: %v raw=%q", err, truncate(text, 200))
		return &WhatsAppParseResult{
			Reply:   "I couldn't quite catch that. Try something like \"milk khatam, add to list\".",
			Actions: []*WhatsAppParsedAction{},
		}, nil
	}
	for _, action := range actions {
		normalizeWhatsAppAction(action)
	}
	if len(actions) > maxWhatsAppActionsPerMessage {
		actions = actions[:maxWhatsAppActionsPerMessage]
	}
	if strings.TrimSpace(reply) == "" {
		reply = defaultBuddyReply(actions)
	}
	return &WhatsAppParseResult{Reply: strings.TrimSpace(reply), Actions: actions}, nil
}

func formatWhatsAppHistory(history []WhatsAppChatTurn) string {
	if len(history) == 0 {
		return ""
	}
	start := 0
	if len(history) > maxWhatsAppHistoryTurns {
		start = len(history) - maxWhatsAppHistoryTurns
	}
	var b strings.Builder
	b.WriteString("Recent chat:\n")
	for _, turn := range history[start:] {
		text := strings.TrimSpace(turn.Text)
		if text == "" {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(turn.Role))
		label := "User"
		if role == "buddy" || role == "assistant" {
			label = "Buddy"
		}
		b.WriteString(fmt.Sprintf("%s: %s\n", label, text))
	}
	b.WriteString("\n")
	return b.String()
}

func defaultBuddyReply(actions []*WhatsAppParsedAction) string {
	appliable := 0
	for _, a := range actions {
		if a != nil && a.Intent != IntentUnknown && a.Confidence >= 0.5 {
			appliable++
		}
	}
	if appliable == 0 {
		return "Tell me what you'd like to update in your kitchen."
	}
	if appliable == 1 {
		return "Here's what I'll do — confirm when it looks right."
	}
	return fmt.Sprintf("I found %d updates — confirm when this looks right.", appliable)
}

func parseWhatsAppChatJSON(responseText string) (reply string, actions []*WhatsAppParsedAction, err error) {
	defer func() {
		if err == nil {
			enrichWhatsAppActionsFromReply(reply, actions)
		}
	}()

	cleaned := cleanJSONFence(responseText)

	var payload struct {
		Reply   string                 `json:"reply"`
		Actions []WhatsAppParsedAction `json:"actions"`
	}
	if err := json.Unmarshal([]byte(cleaned), &payload); err == nil {
		return payload.Reply, actionsFromSlice(payload.Actions), nil
	}

	if start, end := strings.Index(cleaned, "{"), strings.LastIndex(cleaned, "}"); start != -1 && end > start {
		chunk := cleaned[start : end+1]
		if err := json.Unmarshal([]byte(chunk), &payload); err == nil {
			return payload.Reply, actionsFromSlice(payload.Actions), nil
		}
	}

	if reply, actions, ok := salvageWhatsAppChatJSON(cleaned); ok {
		return reply, actions, nil
	}

	// Legacy: actions-only payload.
	legacyActions, legacyErr := parseWhatsAppActionsJSON(responseText)
	if legacyErr != nil {
		return "", nil, legacyErr
	}
	return "", legacyActions, nil
}

// salvageWhatsAppChatJSON repairs Groq replies cut off by max_tokens (reply present, actions incomplete).
func salvageWhatsAppChatJSON(cleaned string) (string, []*WhatsAppParsedAction, bool) {
	reply := extractWhatsAppReplyField(cleaned)

	start := strings.Index(cleaned, "{")
	if start == -1 {
		if reply != "" {
			return reply, nil, true
		}
		return "", nil, false
	}
	fragment := cleaned[start:]

	suffixes := []string{
		`"}]}`,
		`"confidence":0.85,"summary":"","entities":{}}]}`,
		`"confidence":0.85,"summary":"task","entities":{"item_name":"","qty":1,"unit":"pcs"}}]}`,
	}
	for _, suf := range suffixes {
		var payload struct {
			Reply   string                 `json:"reply"`
			Actions []WhatsAppParsedAction `json:"actions"`
		}
		if err := json.Unmarshal([]byte(fragment+suf), &payload); err == nil {
			actions := actionsFromSlice(payload.Actions)
			outReply := strings.TrimSpace(payload.Reply)
			if outReply == "" {
				outReply = reply
			}
			if outReply != "" || len(actions) > 0 {
				return outReply, actions, true
			}
		}
	}

	if reply != "" {
		if m := whatsappIntentFieldPattern.FindStringSubmatch(fragment); len(m) > 1 {
			action := &WhatsAppParsedAction{
				Intent:     WhatsAppParseIntent(m[1]),
				Confidence: 0.8,
				Summary:    "Task from voice message",
			}
			if im := whatsappItemNameFieldPattern.FindStringSubmatch(fragment); len(im) > 1 {
				action.Entities.ItemName = im[1]
			}
			return reply, []*WhatsAppParsedAction{action}, true
		}
		return reply, nil, true
	}

	return "", nil, false
}

func extractWhatsAppReplyField(cleaned string) string {
	m := whatsappReplyFieldPattern.FindStringSubmatch(cleaned)
	if len(m) < 2 {
		return ""
	}
	var reply string
	if err := json.Unmarshal([]byte(`"`+m[1]+`"`), &reply); err != nil {
		return ""
	}
	return strings.TrimSpace(reply)
}

func inferItemNameFromBuddyReply(reply string) string {
	reply = strings.TrimSpace(reply)
	if reply == "" {
		return ""
	}
	if m := buddyReplyItemPattern.FindStringSubmatch(reply); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func enrichWhatsAppActionsFromReply(reply string, actions []*WhatsAppParsedAction) {
	for _, action := range actions {
		if action == nil || strings.TrimSpace(action.Entities.ItemName) != "" {
			continue
		}
		action.Entities.ItemName = inferItemNameFromBuddyReply(reply)
	}
}

func parseWhatsAppActionsJSON(responseText string) ([]*WhatsAppParsedAction, error) {
	cleaned := cleanJSONFence(responseText)

	var payload struct {
		Actions []WhatsAppParsedAction `json:"actions"`
	}
	if err := json.Unmarshal([]byte(cleaned), &payload); err == nil && len(payload.Actions) > 0 {
		return actionsFromSlice(payload.Actions), nil
	}

	if start, end := strings.Index(cleaned, "{"), strings.LastIndex(cleaned, "}"); start != -1 && end > start {
		chunk := cleaned[start : end+1]
		if err := json.Unmarshal([]byte(chunk), &payload); err == nil && len(payload.Actions) > 0 {
			return actionsFromSlice(payload.Actions), nil
		}
	}

	if m := whatsappActionsArrayPattern.FindString(cleaned); m != "" {
		wrapped := "{" + m + "}"
		if err := json.Unmarshal([]byte(wrapped), &payload); err == nil && len(payload.Actions) > 0 {
			return actionsFromSlice(payload.Actions), nil
		}
	}

	// Legacy single-action object fallback.
	single, err := parseWhatsAppActionJSON(responseText)
	if err != nil {
		return nil, err
	}
	return []*WhatsAppParsedAction{single}, nil
}

func actionsFromSlice(in []WhatsAppParsedAction) []*WhatsAppParsedAction {
	out := make([]*WhatsAppParsedAction, 0, len(in))
	for i := range in {
		a := in[i]
		out = append(out, &a)
	}
	return out
}

func cleanJSONFence(responseText string) string {
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
	return strings.TrimSpace(cleaned)
}

// Legacy single-object parser (kept for fallback).
func parseWhatsAppActionJSON(responseText string) (*WhatsAppParsedAction, error) {
	cleaned := cleanJSONFence(responseText)

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
	a.Entities.Unit = units.Normalize(a.Entities.Unit)
	if a.Entities.Qty <= 0 {
		a.Entities.Qty = 1
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

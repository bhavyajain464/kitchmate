package services

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"kitchenai-backend/pkg/config"
)

//go:embed prompts/system.md
var systemKnowledge string

//go:embed prompts/meal_catalog.md
var mealCatalogKnowledge string

const (
	groqMaxTokensDefault      = 2048
	groqMaxTokensMeals        = 2400 // 3 meals JSON; 1400 caused truncation → silent fallback in UI
	groqMaxTokensNLU          = 512 // buddy reply + actions JSON; 220 truncated mid-object
	groqMaxTokensShelfLife    = 512
	groqMaxTokensBillScan     = 500 // compact tuples; free-tier qwen OTPM ≈ 1000
	groqMaxTokensOrderSuggest = 720

	nluSystemPrompt = "Classify Indian kitchen WhatsApp. Return one compact JSON object only, no markdown. Keep reply short."
)

var shelfLifeObjectPattern = regexp.MustCompile(`\{[^{}]*"name"\s*:\s*"[^"]+"[^{}]*"shelf_life_days"\s*:\s*-?\d+[^{}]*\}`)

const groqChatURL = "https://api.groq.com/openai/v1/chat/completions"

type groqChatRequest struct {
	Model            string        `json:"model"`
	Messages         []groqMessage `json:"messages"`
	Temperature      float64       `json:"temperature"`
	MaxTokens        int           `json:"max_tokens,omitempty"`
	TopP             *float64      `json:"top_p,omitempty"`
	Seed             *int64        `json:"seed,omitempty"`
	ReasoningEffort  string        `json:"reasoning_effort,omitempty"` // qwen: "none"|"default"; gpt-oss: low|medium|high
}

type groqMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type groqChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

var groqHTTPClient = &http.Client{Timeout: 120 * time.Second}

func withSystemPrompt(messages []groqMessage) []groqMessage {
	knowledge := strings.TrimSpace(systemKnowledge)
	if knowledge == "" {
		return messages
	}
	for _, m := range messages {
		if m.Role == "system" {
			return messages
		}
	}
	out := make([]groqMessage, 0, len(messages)+1)
	out = append(out, groqMessage{Role: "system", Content: knowledge})
	out = append(out, messages...)
	return out
}

func groqChat(ctx context.Context, apiKey, model string, temperature float64, maxTokens int, messages []groqMessage) (string, error) {
	return groqChatWithSampling(ctx, apiKey, model, temperature, nil, nil, maxTokens, messages, true)
}

// groqChatBillExtract runs bill OCR text parsing without system knowledge.
// Reasoning effort is forced to "none" for Qwen (see groqReasoningEffort).
func groqChatBillExtract(ctx context.Context, apiKey, model string, maxTokens int, messages []groqMessage) (string, error) {
	return groqDoChat(ctx, apiKey, model, 0.1, nil, nil, maxTokens, messages, false, "none")
}

func groqChatWithSampling(ctx context.Context, apiKey, model string, temperature float64, topP *float64, seed *int64, maxTokens int, messages []groqMessage, includeSystemKnowledge bool) (string, error) {
	return groqDoChat(ctx, apiKey, model, temperature, topP, seed, maxTokens, messages, includeSystemKnowledge, "")
}

// groqReasoningEffort picks a safe reasoning_effort for the model.
// Qwen defaults to "none" so max_tokens is not consumed by <think> blocks.
// Explicit requested values win; gpt-oss and others omit the field unless set.
func groqReasoningEffort(model, requested string) string {
	if v := strings.TrimSpace(requested); v != "" {
		return v
	}
	if strings.Contains(strings.ToLower(model), "qwen") {
		return "none"
	}
	return ""
}

func groqDoChat(ctx context.Context, apiKey, model string, temperature float64, topP *float64, seed *int64, maxTokens int, messages []groqMessage, includeSystemKnowledge bool, reasoningEffort string) (string, error) {
	if strings.TrimSpace(apiKey) == "" {
		return "", fmt.Errorf("groq API key is empty")
	}
	if strings.TrimSpace(model) == "" {
		return "", fmt.Errorf("groq model is empty")
	}
	if maxTokens <= 0 {
		maxTokens = groqMaxTokensDefault
	}

	msgs := messages
	if includeSystemKnowledge {
		msgs = withSystemPrompt(messages)
	}
	body, err := json.Marshal(groqChatRequest{
		Model:           model,
		Messages:        msgs,
		Temperature:     temperature,
		MaxTokens:       maxTokens,
		TopP:            topP,
		Seed:            seed,
		ReasoningEffort: groqReasoningEffort(model, reasoningEffort),
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, groqChatURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := groqHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)

	var parsed groqChatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("groq: invalid JSON (%s): %w", resp.Status, err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return "", fmt.Errorf("groq: %s", parsed.Error.Message)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("groq: HTTP %s: %s", resp.Status, string(raw))
	}
	if len(parsed.Choices) == 0 || parsed.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("groq: empty response")
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}

func GroqChatText(ctx context.Context, apiKey, model string, temperature float64, user string) (string, error) {
	return groqChat(ctx, apiKey, model, temperature, groqMaxTokensDefault, []groqMessage{
		{Role: "user", Content: user},
	})
}

// GroqChatNLU classifies short messages with a tiny system prompt and output cap (no full knowledge base).
func GroqChatNLU(ctx context.Context, apiKey, model, user string) (string, error) {
	return groqChat(ctx, apiKey, model, 0.1, groqMaxTokensNLU, []groqMessage{
		{Role: "system", Content: nluSystemPrompt},
		{Role: "user", Content: user},
	})
}

const mealFilterSystemPrompt = `You filter a pre-matched dish shortlist for a household meal app.
Rules: pick ONLY dish names from the numbered list; never invent new dishes; respect MUST dietary lines; output exactly ONE meal per category; if the user names an ingredient or dish, that meal must clearly match it — never add unrelated dishes for variety; output pure JSON only.`

// GroqChatTextMeals is the legacy path (large system + meal catalog).
func GroqChatTextMeals(ctx context.Context, apiKey, model, user string) (string, error) {
	topP := 0.98
	tp := topP
	return groqChatWithSampling(ctx, apiKey, model, 1.0, &tp, nil, groqMaxTokensMeals, mealMessages(user), true)
}

// GroqChatFilterMeals stage-2: refine top word-matched candidates into one final meal.
func GroqChatFilterMeals(ctx context.Context, apiKey, model, user string) (string, error) {
	return groqChatWithSampling(ctx, apiKey, model, 0.55, nil, nil, groqMaxTokensMeals, []groqMessage{
		{Role: "system", Content: mealFilterSystemPrompt},
		{Role: "user", Content: user},
	}, true)
}

// GroqChatOrderSuggest proposes groceries missing from pantry for frequent meals.
func GroqChatOrderSuggest(ctx context.Context, apiKey, model, user string, seed *int64) (string, error) {
	const orderSuggestSystemPrompt = `You suggest grocery items for an Indian household kitchen app.
Output ONLY valid JSON (no markdown). Schema:
{"items":[{"name":"string","qty":number,"unit":"pcs|kg|g|L|ml","reason":"short"}],"summary":"one sentence"}
Rules:
- Suggest items NOT in pantry and NOT already on shopping list.
- Use BOTH meal history and catalog.json ingredient profiles provided in the user message.
- Prioritize catalog-derived staples that are missing from pantry and needed for meals they cook often.
- Use simple English grocery names (onion, tomato, paneer, atta).
- NEVER suggest bundled names like "mixed vegetables" or "whole spices" — list specific items (carrot, french beans, cauliflower, peas, capsicum, cumin seeds, etc.).
- NEVER suggest roti, chapati, paratha, naan, or bread if atta, wheat flour, or maida is already in pantry (they make bread at home).
- NEVER suggest steamed rice or jeera rice if rice or chawal is in pantry.
- Do not repeat items listed under "already suggested this session".
- qty may be 0 if unknown; unit defaults to pcs.
- Maximum 4 items. If nothing to suggest, return {"items":[],"summary":"brief explanation"}.`
	topP := 0.92
	return groqChatWithSampling(ctx, apiKey, model, 0.8, &topP, seed, groqMaxTokensOrderSuggest, []groqMessage{
		{Role: "system", Content: orderSuggestSystemPrompt},
		{Role: "user", Content: user},
	}, true)
}

func mealMessages(user string) []groqMessage {
	systemParts := make([]string, 0, 2)
	if g := strings.TrimSpace(systemKnowledge); g != "" {
		systemParts = append(systemParts, g)
	}
	if c := strings.TrimSpace(mealCatalogKnowledge); c != "" {
		systemParts = append(systemParts, c)
	}
	messages := make([]groqMessage, 0, 2)
	if len(systemParts) > 0 {
		messages = append(messages, groqMessage{Role: "system", Content: strings.Join(systemParts, "\n")})
	}
	messages = append(messages, groqMessage{Role: "user", Content: user})
	return messages
}

func EstimateShelfLifeGroq(ctx context.Context, cfg *config.Config, itemNames []string) ([]ShelfLifeEstimate, error) {
	if !cfg.HasGroqAPIKey() {
		return nil, fmt.Errorf("groq API key not configured")
	}
	maxOut := groqMaxTokensShelfLife
	if n := len(itemNames) * 28; n > maxOut {
		maxOut = n
	}
	if maxOut > 2048 {
		maxOut = 2048
	}
	prompt := fmt.Sprintf(`Shelf life in days (Indian home storage) for: %s. JSON array only: [{"name":"...","shelf_life_days":N}]`, strings.Join(itemNames, ", "))

	text, err := groqChat(ctx, cfg.PickGroqAPIKey(), cfg.EffectiveGroqModel(), 0.1, maxOut, []groqMessage{
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, fmt.Errorf("groq shelf life: %w", err)
	}
	return parseShelfLifeJSON(text)
}

func parseShelfLifeJSON(responseText string) ([]ShelfLifeEstimate, error) {
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

	var estimates []ShelfLifeEstimate
	if err := json.Unmarshal([]byte(cleaned), &estimates); err == nil {
		return estimates, nil
	}

	if start, end := strings.Index(cleaned, "["), strings.LastIndex(cleaned, "]"); start != -1 && end > start {
		if err := json.Unmarshal([]byte(cleaned[start:end+1]), &estimates); err == nil {
			return estimates, nil
		}
	}

	salvaged := salvageShelfLifeObjects(cleaned)
	if len(salvaged) > 0 {
		preview := cleaned
		if len(preview) > 240 {
			preview = preview[:240] + "…"
		}
		log.Printf("[shelf-life] partial parse: recovered %d object(s); raw=%q", len(salvaged), preview)
		return salvaged, nil
	}

	preview := cleaned
	if len(preview) > 240 {
		preview = preview[:240] + "…"
	}
	return nil, fmt.Errorf("failed to parse shelf life response: no JSON objects found; raw=%q", preview)
}

func salvageShelfLifeObjects(s string) []ShelfLifeEstimate {
	matches := shelfLifeObjectPattern.FindAllString(s, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]ShelfLifeEstimate, 0, len(matches))
	for _, m := range matches {
		var e ShelfLifeEstimate
		if err := json.Unmarshal([]byte(m), &e); err != nil {
			continue
		}
		if strings.TrimSpace(e.Name) == "" || e.ShelfLifeDays <= 0 {
			continue
		}
		out = append(out, e)
	}
	return out
}

var (
	// Deprecated verbose prompt kept only if referenced; Groq text path uses billScanCompactTextPrompt.
	billScanGroqTextPrompt = billScanCompactTextPrompt
)

func ScanBillGroqFromPDF(ctx context.Context, cfg *config.Config, pdfData []byte) ([]BillItem, error) {
	text, err := ExtractPDFText(pdfData)
	if err != nil {
		return nil, err
	}
	return scanBillGroqFromInvoiceText(ctx, cfg, text)
}

func ScanBillGroqFromBase64(ctx context.Context, cfg *config.Config, base64Image, imageType string) ([]BillItem, error) {
	if !cfg.HasGroqAPIKey() {
		return nil, fmt.Errorf("groq API key not configured")
	}
	imageData, err := decodeBase64BillData(base64Image)
	if err != nil {
		return nil, err
	}
	return scanBillGroqFromImage(ctx, cfg, imageData, imageType)
}

func ScanBillGroqFromBytes(ctx context.Context, cfg *config.Config, imageData []byte, imageType string) ([]BillItem, error) {
	if !cfg.HasGroqAPIKey() {
		return nil, fmt.Errorf("groq API key not configured")
	}
	return scanBillGroqFromImage(ctx, cfg, imageData, imageType)
}

// scanBillGroqFromImage runs Google Vision OCR, then parses items with the Groq text model only.
func scanBillGroqFromImage(ctx context.Context, cfg *config.Config, imageData []byte, _ string) ([]BillItem, error) {
	ocrText, ocrErr := ExtractBillImageText(ctx, cfg, imageData)
	if ocrErr != nil {
		return nil, fmt.Errorf("bill OCR failed: %w", ocrErr)
	}
	ocrText = strings.TrimSpace(ocrText)
	if len(ocrText) < minBillOCRChars {
		return nil, fmt.Errorf("not enough text detected on bill image")
	}
	items, parseErr := scanBillGroqFromInvoiceText(ctx, cfg, ocrText)
	if parseErr != nil {
		return nil, fmt.Errorf("failed to parse bill from OCR text: %w", parseErr)
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("no edible items found on bill")
	}
	log.Printf("[bill-scan] %d item(s) from OCR + text model", len(items))
	return items, nil
}

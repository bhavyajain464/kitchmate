package services

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
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
	groqMaxTokensDefault  = 2048
	groqMaxTokensMeals    = 2400 // 3 meals JSON; 1400 caused truncation → silent fallback in UI
	groqMaxTokensNLU      = 220
	groqMaxTokensShelfLife = 512
	groqMaxTokensBillScan = 1800

	nluSystemPrompt = "Classify Indian kitchen WhatsApp. One JSON object only, no markdown."
)

var shelfLifeObjectPattern = regexp.MustCompile(`\{[^{}]*"name"\s*:\s*"[^"]+"[^{}]*"shelf_life_days"\s*:\s*-?\d+[^{}]*\}`)

const groqChatURL = "https://api.groq.com/openai/v1/chat/completions"

type groqChatRequest struct {
	Model       string        `json:"model"`
	Messages    []groqMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	TopP        *float64      `json:"top_p,omitempty"`
	Seed        *int64        `json:"seed,omitempty"`
}

type groqMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type groqContentPart struct {
	Type     string        `json:"type"`
	Text     string        `json:"text,omitempty"`
	ImageURL *groqImageURL `json:"image_url,omitempty"`
}

type groqImageURL struct {
	URL string `json:"url"`
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
	return groqChatWithSampling(ctx, apiKey, model, temperature, nil, nil, maxTokens, messages)
}

func groqChatWithSampling(ctx context.Context, apiKey, model string, temperature float64, topP *float64, seed *int64, maxTokens int, messages []groqMessage) (string, error) {
	if strings.TrimSpace(apiKey) == "" {
		return "", fmt.Errorf("groq API key is empty")
	}
	if strings.TrimSpace(model) == "" {
		return "", fmt.Errorf("groq model is empty")
	}
	if maxTokens <= 0 {
		maxTokens = groqMaxTokensDefault
	}

	body, err := json.Marshal(groqChatRequest{
		Model:       model,
		Messages:    withSystemPrompt(messages),
		Temperature: temperature,
		MaxTokens:   maxTokens,
		TopP:        topP,
		Seed:        seed,
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
	return groqChatWithSampling(ctx, apiKey, model, 1.0, &tp, nil, groqMaxTokensMeals, mealMessages(user))
}

// GroqChatFilterMeals stage-2: refine top word-matched candidates into one final meal.
func GroqChatFilterMeals(ctx context.Context, apiKey, model, user string) (string, error) {
	return groqChatWithSampling(ctx, apiKey, model, 0.55, nil, nil, groqMaxTokensMeals, []groqMessage{
		{Role: "system", Content: mealFilterSystemPrompt},
		{Role: "user", Content: user},
	})
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

func GroqChatVision(ctx context.Context, apiKey, model string, temperature float64, userText, mimeType, base64Image string) (string, error) {
	mime := strings.TrimSpace(mimeType)
	if mime == "" {
		mime = "image/jpeg"
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", mime, strings.TrimSpace(base64Image))
	parts := []groqContentPart{
		{Type: "text", Text: userText},
		{Type: "image_url", ImageURL: &groqImageURL{URL: dataURL}},
	}
	return groqChat(ctx, apiKey, model, temperature, groqMaxTokensBillScan, []groqMessage{
		{Role: "user", Content: parts},
	})
}

func EstimateShelfLifeGroq(ctx context.Context, cfg *config.Config, itemNames []string) ([]ShelfLifeEstimate, error) {
	if cfg.GroqAPIKey == "" {
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

	text, err := groqChat(ctx, cfg.GroqAPIKey, cfg.GroqModel, 0.1, maxOut, []groqMessage{
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

const billScanGroqUserPrompt = `Read this Indian grocery bill. Edible/kitchen items only (no soap, detergent, etc.).
Per item: name, quantity, unit, price_per_unit (0 if unknown), total_price (0 if unknown), shelf_life_days.
JSON array only, no markdown:
[{"name":"Basmati Rice","quantity":5,"unit":"kg","price_per_unit":120,"total_price":600,"shelf_life_days":60}]`

func ScanBillGroqFromBase64(ctx context.Context, cfg *config.Config, base64Image, imageType string) ([]BillItem, error) {
	if cfg.GroqAPIKey == "" {
		return nil, fmt.Errorf("groq API key not configured")
	}
	model := cfg.GroqVisionModel
	if model == "" {
		model = "llama-3.2-11b-vision-preview"
	}
	text, err := GroqChatVision(ctx, cfg.GroqAPIKey, model, 0.1, billScanGroqUserPrompt, imageType, base64Image)
	if err != nil {
		return nil, fmt.Errorf("groq bill scan: %w", err)
	}
	return ParseBillItems(text)
}

func ScanBillGroqFromBytes(ctx context.Context, cfg *config.Config, imageData []byte, imageType string) ([]BillItem, error) {
	return ScanBillGroqFromBase64(ctx, cfg, base64.StdEncoding.EncodeToString(imageData), imageType)
}

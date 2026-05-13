package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"kitchenai-backend/pkg/config"
)

const groqChatURL = "https://api.groq.com/openai/v1/chat/completions"

type groqChatRequest struct {
	Model       string          `json:"model"`
	Messages    []groqMessage   `json:"messages"`
	Temperature float64         `json:"temperature"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	TopP        *float64        `json:"top_p,omitempty"`
	Seed        *int64          `json:"seed,omitempty"`
}

type groqMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"` // string or []groqContentPart for vision
}

type groqContentPart struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	ImageURL *groqImageURL   `json:"image_url,omitempty"`
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

func groqChat(ctx context.Context, apiKey, model string, temperature float64, messages []groqMessage) (string, error) {
	return groqChatWithSampling(ctx, apiKey, model, temperature, nil, nil, messages)
}

// groqChatWithSampling calls Groq chat completions; topP and seed may be nil to omit from the request.
func groqChatWithSampling(ctx context.Context, apiKey, model string, temperature float64, topP *float64, seed *int64, messages []groqMessage) (string, error) {
	if strings.TrimSpace(apiKey) == "" {
		return "", fmt.Errorf("groq API key is empty")
	}
	if strings.TrimSpace(model) == "" {
		return "", fmt.Errorf("groq model is empty")
	}

	body, err := json.Marshal(groqChatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   8192,
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

// GroqChatText runs a single-user-message chat completion.
func GroqChatText(ctx context.Context, apiKey, model string, temperature float64, user string) (string, error) {
	return groqChat(ctx, apiKey, model, temperature, []groqMessage{
		{Role: "user", Content: user},
	})
}

// GroqChatTextMeals uses higher sampling randomness (and top_p) so repeated regenerations with the
// same inventory tend to produce different dishes while staying valid JSON.
func GroqChatTextMeals(ctx context.Context, apiKey, model, user string) (string, error) {
	topP := 0.98
	tp := topP
	return groqChatWithSampling(ctx, apiKey, model, 1.0, &tp, nil, []groqMessage{
		{Role: "user", Content: user},
	})
}

// GroqChatVision sends one text block plus one inline image (data URL).
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
	return groqChat(ctx, apiKey, model, temperature, []groqMessage{
		{Role: "user", Content: parts},
	})
}

// EstimateShelfLifeGroq estimates shelf life using Groq (same JSON shape as Gemini).
func EstimateShelfLifeGroq(ctx context.Context, cfg *config.Config, itemNames []string) ([]ShelfLifeEstimate, error) {
	if cfg.GroqAPIKey == "" {
		return nil, fmt.Errorf("groq API key not configured")
	}
	prompt := fmt.Sprintf(`Estimate the shelf life in days for these kitchen/grocery items stored at home in typical Indian household conditions.

Items: %s

Rules:
- Fresh vegetables: 5-10 days
- Leafy greens: 2-3 days
- Milk/dairy: 2-5 days
- Paneer/tofu: 3-5 days
- Rice/dal/flour/grains: 60-90 days
- Spices (powder): 180 days
- Whole spices: 365 days
- Eggs: 14 days
- Bread: 3-5 days
- Fresh fruits: 3-7 days
- Oil/ghee: 90 days
- Sugar/salt/tea: 180 days
- Packaged/canned food: 90-180 days

Return ONLY a JSON array, no markdown:
[{"name": "item name", "shelf_life_days": 30}]`, strings.Join(itemNames, ", "))

	text, err := GroqChatText(ctx, cfg.GroqAPIKey, cfg.GroqModel, 0.1, prompt)
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
	if err := json.Unmarshal([]byte(cleaned), &estimates); err != nil {
		start := strings.Index(cleaned, "[")
		end := strings.LastIndex(cleaned, "]")
		if start != -1 && end != -1 && end > start {
			if err2 := json.Unmarshal([]byte(cleaned[start:end+1]), &estimates); err2 != nil {
				return nil, fmt.Errorf("failed to parse shelf life response: %w", err2)
			}
		} else {
			return nil, fmt.Errorf("failed to parse shelf life response: %w", err)
		}
	}
	return estimates, nil
}

// billScanGroqUserPrompt matches the Gemini bill-scan instructions (JSON array output).
const billScanGroqUserPrompt = `You are an expert at reading Indian grocery bills. Extract ONLY edible and kitchen-consumable items from this bill.

INCLUDE: food, beverages, cooking ingredients, spices, grains, dairy, produce, snacks, packaged food.
EXCLUDE: non-food items like toilet paper, baby wipes, detergent, soap, shampoo, cleaning supplies, plastic bags, batteries, tissues, toothpaste, diapers, pet food, stationery, or any non-edible household product.

For each edible item provide:
- name: standardized common Indian grocery name
- quantity: numeric quantity
- unit: kg, liters, pieces, grams, packets, etc.
- price_per_unit: price per unit if visible (0 if not)
- total_price: total price if visible (0 if not)
- shelf_life_days: estimated shelf life in days stored at home in Indian conditions:
  * Fresh vegetables: 5-10 days
  * Leafy greens: 2-3 days
  * Milk/dairy: 2-5 days
  * Paneer/tofu: 3-5 days
  * Rice/dal/flour: 30-90 days
  * Spices: 180 days
  * Eggs: 14 days
  * Bread: 3-5 days
  * Fruits: 3-7 days
  * Oil/ghee: 90 days
  * Packaged/canned food: 60-180 days

Return ONLY a JSON array, no markdown, no explanation:
[
  {"name": "Basmati Rice", "quantity": 5, "unit": "kg", "price_per_unit": 120, "total_price": 600, "shelf_life_days": 60},
  {"name": "Tomatoes", "quantity": 2, "unit": "kg", "price_per_unit": 40, "total_price": 80, "shelf_life_days": 7}
]`

// ScanBillGroqFromBase64 scans a bill image via Groq vision.
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

// ScanBillGroqFromBytes scans raw image bytes (JPEG/PNG).
func ScanBillGroqFromBytes(ctx context.Context, cfg *config.Config, imageData []byte, imageType string) ([]BillItem, error) {
	// Groq vision path expects base64 in the data URL; reuse Gemini path encoding.
	return ScanBillGroqFromBase64(ctx, cfg, base64.StdEncoding.EncodeToString(imageData), imageType)
}

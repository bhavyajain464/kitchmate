package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	invgroup "kitchenai-backend/internal/services/inventory"
	"kitchenai-backend/pkg/units"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

// GeminiService handles interactions with Google Gemini API for bill scanning
type GeminiService struct {
	client *genai.Client
	model  string
}

// NewGeminiService creates a new Gemini service instance
func NewGeminiService(apiKey, model string) (*GeminiService, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("Gemini API key is required")
	}

	ctx := context.Background()
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, fmt.Errorf("failed to create Gemini client: %w", err)
	}

	return &GeminiService{
		client: client,
		model:  model,
	}, nil
}

// Close closes the Gemini client
func (s *GeminiService) Close() {
	if s.client != nil {
		s.client.Close()
	}
}

// ScanBill processes an image of a grocery bill and extracts items
func (s *GeminiService) ScanBill(imageData []byte, imageType string) ([]BillItem, error) {
	ctx := context.Background()
	model := s.client.GenerativeModel(s.model)

	// Configure the model for bill scanning
	model.SetTemperature(0.1)
	model.SetTopP(0.95)

	prompt := `You are an expert at reading Indian grocery bills. Extract ONLY edible and kitchen-consumable items from this bill.

INCLUDE: food, beverages, cooking ingredients, spices, grains, dairy, produce, snacks, packaged food.
EXCLUDE: non-food items like toilet paper, baby wipes, detergent, soap, shampoo, cleaning supplies, plastic bags, batteries, tissues, toothpaste, diapers, pet food, stationery, or any non-edible household product.

For each edible item provide:
- name: simple grocery ingredient name only (e.g. "Jeera", "Tomato", "Basmati Rice") — not brand pack titles like "Catch Jeera Whole 100g"
- quantity: numeric quantity
- unit: kg, L, ml, g, pcs (count items), etc.
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
` + billScanFoodGroupField() + `

` + billScanJSONOutputSpec()

	// Build multimodal parts (images or PDF).
	parts := []genai.Part{
		genai.Text(prompt),
	}

	mime := strings.ToLower(strings.TrimSpace(strings.Split(imageType, ";")[0]))
	if strings.Contains(mime, "pdf") {
		parts = append(parts, genai.Blob{MIMEType: "application/pdf", Data: imageData})
	} else {
		format := "jpeg"
		if strings.HasPrefix(imageType, "image/") {
			format = strings.TrimPrefix(mime, "image/")
			if format == "jpg" {
				format = "jpeg"
			}
		}
		parts = append(parts, genai.ImageData(format, imageData))
	}

	// Generate content
	resp, err := model.GenerateContent(ctx, parts...)
	if err != nil {
		return nil, fmt.Errorf("failed to generate content: %w", err)
	}

	if resp.Candidates == nil || len(resp.Candidates) == 0 {
		return nil, fmt.Errorf("no response from Gemini")
	}

	// Extract the text response
	var responseText string
	for _, part := range resp.Candidates[0].Content.Parts {
		if text, ok := part.(genai.Text); ok {
			responseText = string(text)
			break
		}
	}

	if responseText == "" {
		return nil, fmt.Errorf("empty response from Gemini")
	}

	// Parse the JSON response
	items, err := ParseBillItems(responseText)
	if err != nil {
		return nil, fmt.Errorf("failed to parse bill items: %w", err)
	}

	return items, nil
}

// ScanBillFromBase64 processes a base64-encoded image
func (s *GeminiService) ScanBillFromBase64(base64Image, imageType string) ([]BillItem, error) {
	// Decode base64 image
	imageData, err := base64.StdEncoding.DecodeString(base64Image)
	if err != nil {
		return nil, fmt.Errorf("failed to decode base64 image: %w", err)
	}

	return s.ScanBill(imageData, imageType)
}

// ScanBillFromReader processes an image from an io.Reader
func (s *GeminiService) ScanBillFromReader(reader io.Reader, imageType string) ([]BillItem, error) {
	// Read all image data
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, reader); err != nil {
		return nil, fmt.Errorf("failed to read image data: %w", err)
	}

	return s.ScanBill(buf.Bytes(), imageType)
}

// BillItem represents a single item extracted from a grocery bill
type BillItem struct {
	Name          string  `json:"name"`
	Quantity      float64 `json:"quantity"`
	Unit          string  `json:"unit"`
	PricePerUnit  float64 `json:"price_per_unit,omitempty"`
	TotalPrice    float64 `json:"total_price,omitempty"`
	ShelfLifeDays int     `json:"shelf_life_days,omitempty"`
	FoodGroup     string  `json:"food_group,omitempty"`
	IngredientID  string  `json:"ingredient_id,omitempty"`
}

// ShelfLifeEstimate holds an item name and its estimated shelf life
type ShelfLifeEstimate struct {
	Name          string `json:"name"`
	ShelfLifeDays int    `json:"shelf_life_days"`
}

// EstimateShelfLife asks Gemini to estimate shelf life for a list of item names
func (s *GeminiService) EstimateShelfLife(itemNames []string) ([]ShelfLifeEstimate, error) {
	ctx := context.Background()
	model := s.client.GenerativeModel(s.model)
	model.SetTemperature(0.1)

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

	resp, err := model.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return nil, fmt.Errorf("gemini error: %w", err)
	}

	if resp.Candidates == nil || len(resp.Candidates) == 0 {
		return nil, fmt.Errorf("no response from Gemini")
	}

	var responseText string
	for _, part := range resp.Candidates[0].Content.Parts {
		if text, ok := part.(genai.Text); ok {
			responseText = string(text)
			break
		}
	}

	return parseShelfLifeJSON(responseText)
}

// ParseBillItems parses LLM bill-scan JSON into BillItem slice.
// Accepts, in order:
//  1. Compact tuples: [["Potato",1,"kg",14], ...]  // 4th = shelf_life_days
//  2. Short keys: [{"n":"Potato","q":1,"u":"kg","s":14}, ...]
//  3. Legacy objects: [{"name":"Potato","quantity":1,...}, ...]
func ParseBillItems(jsonResponse string) ([]BillItem, error) {
	cleaned := stripMarkdownFence(jsonResponse)
	if cleaned == "" {
		return nil, fmt.Errorf("empty bill scan response")
	}

	if items, ok := tryParseBillItemTuples(cleaned); ok {
		return SanitizeBillItems(items), nil
	}
	if items, ok := tryParseBillItemShortKeys(cleaned); ok {
		return SanitizeBillItems(items), nil
	}

	var items []BillItem
	if err := json.Unmarshal([]byte(cleaned), &items); err != nil {
		var singleItem BillItem
		if err2 := json.Unmarshal([]byte(cleaned), &singleItem); err2 == nil && strings.TrimSpace(singleItem.Name) != "" {
			items = []BillItem{singleItem}
		} else {
			start := strings.Index(cleaned, "[")
			end := strings.LastIndex(cleaned, "]")
			if start != -1 && end != -1 && end > start {
				jsonStr := cleaned[start : end+1]
				if items2, ok := tryParseBillItemTuples(jsonStr); ok {
					return SanitizeBillItems(items2), nil
				}
				if items2, ok := tryParseBillItemShortKeys(jsonStr); ok {
					return SanitizeBillItems(items2), nil
				}
				if err3 := json.Unmarshal([]byte(jsonStr), &items); err3 != nil {
					return nil, fmt.Errorf("failed to parse bill scan JSON: %w", err3)
				}
			} else {
				return nil, fmt.Errorf("no valid JSON found in bill scan response: %w", err)
			}
		}
	}

	return SanitizeBillItems(items), nil
}

func stripMarkdownFence(s string) string {
	cleaned := strings.TrimSpace(s)
	// Drop Qwen-style thinking blocks if reasoning wasn't fully disabled.
	if i := strings.Index(cleaned, "<think>"); i >= 0 {
		if j := strings.Index(cleaned, "</think>"); j > i {
			cleaned = strings.TrimSpace(cleaned[j+len("</think>"):])
		}
	}
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

func tryParseBillItemTuples(raw string) ([]BillItem, bool) {
	var rows [][]any
	if err := json.Unmarshal([]byte(raw), &rows); err != nil || len(rows) == 0 {
		return nil, false
	}
	items := make([]BillItem, 0, len(rows))
	for _, row := range rows {
		if len(row) < 1 {
			continue
		}
		// Reject object-shaped arrays mis-detected as tuples (first elem map).
		if _, isMap := row[0].(map[string]any); isMap {
			return nil, false
		}
		name := anyToString(row[0])
		if strings.TrimSpace(name) == "" {
			continue
		}
		item := BillItem{Name: name, Quantity: 1}
		if len(row) > 1 {
			item.Quantity = anyToFloat(row[1])
		}
		if len(row) > 2 {
			item.Unit = anyToString(row[2])
		}
		if len(row) > 3 {
			item.ShelfLifeDays = int(anyToFloat(row[3]) + 0.5) // round
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return nil, false
	}
	return items, true
}

type billItemShortKey struct {
	N string  `json:"n"`
	Q float64 `json:"q"`
	U string  `json:"u"`
	S float64 `json:"s"` // shelf_life_days
	// Aliases if model mixes short + long keys.
	Name          string  `json:"name"`
	Quantity      float64 `json:"quantity"`
	Unit          string  `json:"unit"`
	ShelfLifeDays float64 `json:"shelf_life_days"`
}

func tryParseBillItemShortKeys(raw string) ([]BillItem, bool) {
	var rows []billItemShortKey
	if err := json.Unmarshal([]byte(raw), &rows); err != nil || len(rows) == 0 {
		return nil, false
	}
	items := make([]BillItem, 0, len(rows))
	shortHits := 0
	for _, r := range rows {
		name := strings.TrimSpace(firstNonEmpty(r.N, r.Name))
		if name == "" {
			continue
		}
		if strings.TrimSpace(r.N) != "" {
			shortHits++
		}
		qty := r.Q
		if qty <= 0 {
			qty = r.Quantity
		}
		unit := firstNonEmpty(r.U, r.Unit)
		shelf := int(r.S + 0.5)
		if shelf <= 0 {
			shelf = int(r.ShelfLifeDays + 0.5)
		}
		items = append(items, BillItem{
			Name:          name,
			Quantity:      qty,
			Unit:          unit,
			ShelfLifeDays: shelf,
		})
	}
	// Prefer this path only when short keys were actually used (or mixed).
	if len(items) == 0 || shortHits == 0 {
		return nil, false
	}
	return items, true
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func anyToString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return fmt.Sprintf("%v", t)
	case json.Number:
		return t.String()
	default:
		return fmt.Sprintf("%v", t)
	}
}

func anyToFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		var f float64
		fmt.Sscanf(strings.TrimSpace(t), "%f", &f)
		return f
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}

// SanitizeBillItems normalizes parsed bill line items (names, units, food groups).
func SanitizeBillItems(items []BillItem) []BillItem {
	for i := range items {
		if items[i].Name == "" {
			items[i].Name = "Unknown Item"
		}
		if items[i].Quantity <= 0 {
			items[i].Quantity = 1
		}
		items[i].Unit = units.Normalize(items[i].Unit)
		items[i].FoodGroup = invgroup.NormalizeFoodGroup(items[i].FoodGroup)
	}
	return items
}

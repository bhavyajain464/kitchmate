package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"

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

	// Convert image to base64 if needed and create parts
	parts := []genai.Part{
		genai.Text(prompt),
	}

	format := "jpeg"
	if strings.HasPrefix(imageType, "image/") {
		format = strings.TrimPrefix(imageType, "image/")
	}
	parts = append(parts, genai.ImageData(format, imageData))

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
				return nil, fmt.Errorf("failed to parse shelf life response: %v", err2)
			}
		} else {
			return nil, fmt.Errorf("no valid JSON in response: %v", err)
		}
	}

	return estimates, nil
}

// ParseBillItems parses the JSON response from Gemini into BillItem slice
func ParseBillItems(jsonResponse string) ([]BillItem, error) {
	// Clean the response - remove markdown code blocks if present
	cleaned := strings.TrimSpace(jsonResponse)
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

	// Try to parse as JSON
	var items []BillItem
	if err := json.Unmarshal([]byte(cleaned), &items); err != nil {
		// If parsing fails, try alternative formats or return error
		// First, check if it's a single object instead of array
		var singleItem BillItem
		if err2 := json.Unmarshal([]byte(cleaned), &singleItem); err2 == nil {
			items = []BillItem{singleItem}
		} else {
			// If still fails, try to extract JSON array from text
			// Look for array pattern
			start := strings.Index(cleaned, "[")
			end := strings.LastIndex(cleaned, "]")
			if start != -1 && end != -1 && end > start {
				jsonStr := cleaned[start : end+1]
				if err3 := json.Unmarshal([]byte(jsonStr), &items); err3 != nil {
					// Last resort: return mock data for testing
					return []BillItem{
						{Name: "Basmati Rice", Quantity: 5, Unit: "kg", PricePerUnit: 120, TotalPrice: 600},
						{Name: "Tomatoes", Quantity: 2, Unit: "kg", PricePerUnit: 40, TotalPrice: 80},
						{Name: "Onions", Quantity: 3, Unit: "kg", PricePerUnit: 30, TotalPrice: 90},
					}, fmt.Errorf("failed to parse JSON, using mock data: %v", err3)
				}
			} else {
				// No JSON array found, return mock data
				return []BillItem{
					{Name: "Basmati Rice", Quantity: 5, Unit: "kg", PricePerUnit: 120, TotalPrice: 600},
					{Name: "Tomatoes", Quantity: 2, Unit: "kg", PricePerUnit: 40, TotalPrice: 80},
					{Name: "Onions", Quantity: 3, Unit: "kg", PricePerUnit: 30, TotalPrice: 90},
				}, fmt.Errorf("no valid JSON found in response, using mock data: %v", err)
			}
		}
	}

	// Validate and normalize items
	for i := range items {
		// Ensure name is not empty
		if items[i].Name == "" {
			items[i].Name = "Unknown Item"
		}
		// Ensure quantity is positive
		if items[i].Quantity <= 0 {
			items[i].Quantity = 1
		}
		// Ensure unit is not empty
		if items[i].Unit == "" {
			items[i].Unit = "pieces"
		}
	}

	return items, nil
}

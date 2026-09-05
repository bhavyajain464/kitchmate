package services

import (
	"fmt"

	invgroup "kitchenai-backend/internal/services/inventory"
)

// billScanFoodGroupField documents food_group for bill-scan LLM prompts (legacy / Gemini multimodal).
func billScanFoodGroupField() string {
	return fmt.Sprintf(`- food_group: pantry category, exactly one of: %s`, invgroup.PromptGroupList())
}

// billScanCompactTextPrompt is the Groq OCR→text bill parser prompt.
// Output is a dense JSON tuple array to minimize completion tokens:
//   [[name, qty, unit, shelf_life_days], ...]
// food_group / prices are filled later (catalog mapping; prices unused for pantry).
const billScanCompactTextPrompt = `Indian grocery invoice OCR. Extract edible/kitchen lines only.
Exclude fees, delivery, bags, tax/GST rows, discounts, non-food.

Each row: [name, qty, unit, shelf_days]
- name: ingredient only (no brand/pack size), e.g. "Jeera","Tomato"
- qty: number sold (default 1)
- unit: kg|g|L|ml|pcs
- shelf_days: home storage days (veg 5-10, leafy 2-3, dairy 2-5, dal/rice 60-90, spices 180, oil 90)

Reply with ONLY a JSON array of arrays. No keys, no markdown.
Example: [["Potato",1,"kg",14],["Onion",0.5,"kg",14],["Milk",1,"L",4]]`

// billScanJSONOutputSpec is the legacy verbose object schema (Gemini image path).
func billScanJSONOutputSpec() string {
	return `Return ONLY a JSON array, no markdown. Each element: name (string), quantity (number), unit (string), price_per_unit (number, 0 if unknown), total_price (number, 0 if unknown), shelf_life_days (number), food_group (string).`
}

// billScanCompactJSONOutputSpec documents the compact tuple schema for shared callers.
func billScanCompactJSONOutputSpec() string {
	return `Return ONLY a JSON array of arrays, no markdown: [[name,qty,unit,shelf_days],...]`
}

package services

import (
	"context"
	"fmt"

	"kitchenai-backend/pkg/config"
)

// EstimateShelfLifeForConfig runs shelf-life estimation using the single LLM chosen by cfg.LLMProvider.
func EstimateShelfLifeForConfig(ctx context.Context, cfg *config.Config, itemNames []string) ([]ShelfLifeEstimate, error) {
	if len(itemNames) == 0 {
		return nil, nil
	}
	switch cfg.LLMProvider {
	case "gemini":
		if cfg.GeminiAPIKey == "" {
			return nil, fmt.Errorf("LLM_PROVIDER=gemini but GEMINI_API_KEY is empty")
		}
		g, err := NewGeminiService(cfg.GeminiAPIKey, cfg.GeminiModel)
		if err != nil {
			return nil, err
		}
		defer g.Close()
		return g.EstimateShelfLife(itemNames)
	default:
		if cfg.GroqAPIKey == "" {
			return nil, fmt.Errorf("LLM_PROVIDER=groq but GROQ_API_KEY is empty")
		}
		return EstimateShelfLifeGroq(ctx, cfg, itemNames)
	}
}

// ScanBillBase64ForConfig scans a base64-encoded bill image using the configured LLM only.
func ScanBillBase64ForConfig(ctx context.Context, cfg *config.Config, base64Image, imageType string) ([]BillItem, error) {
	switch cfg.LLMProvider {
	case "gemini":
		if cfg.GeminiAPIKey == "" {
			return nil, fmt.Errorf("LLM_PROVIDER=gemini but GEMINI_API_KEY is empty")
		}
		g, err := NewGeminiService(cfg.GeminiAPIKey, cfg.GeminiModel)
		if err != nil {
			return nil, err
		}
		defer g.Close()
		return g.ScanBillFromBase64(base64Image, imageType)
	default:
		if cfg.GroqAPIKey == "" {
			return nil, fmt.Errorf("LLM_PROVIDER=groq but GROQ_API_KEY is empty")
		}
		return ScanBillGroqFromBase64(ctx, cfg, base64Image, imageType)
	}
}

// ScanBillBytesForConfig scans raw image bytes using the configured LLM only.
func ScanBillBytesForConfig(ctx context.Context, cfg *config.Config, imageData []byte, imageType string) ([]BillItem, error) {
	switch cfg.LLMProvider {
	case "gemini":
		if cfg.GeminiAPIKey == "" {
			return nil, fmt.Errorf("LLM_PROVIDER=gemini but GEMINI_API_KEY is empty")
		}
		g, err := NewGeminiService(cfg.GeminiAPIKey, cfg.GeminiModel)
		if err != nil {
			return nil, err
		}
		defer g.Close()
		return g.ScanBill(imageData, imageType)
	default:
		if cfg.GroqAPIKey == "" {
			return nil, fmt.Errorf("LLM_PROVIDER=groq but GROQ_API_KEY is empty")
		}
		return ScanBillGroqFromBytes(ctx, cfg, imageData, imageType)
	}
}

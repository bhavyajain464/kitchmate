package services

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/joho/godotenv"
	"kitchenai-backend/pkg/config"
)

// TestGroqLiveFromEnv loads ../../.env (from this package dir) and calls Groq once.
// Run: cd backend && go test -v ./internal/services -run TestGroqLiveFromEnv -count=1
func TestGroqLiveFromEnv(t *testing.T) {
	_ = godotenv.Load(filepath.Join("..", "..", ".env"))
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	if cfg.LLMProvider != "groq" || cfg.GroqAPIKey == "" {
		t.Skip("set LLM_PROVIDER=groq and GROQ_API_KEY in backend/.env")
	}
	out, err := GroqChatText(context.Background(), cfg.GroqAPIKey, cfg.GroqModel, 0, "Reply with exactly one token: GROQ_OK")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.TrimSpace(out), "GROQ_OK") {
		t.Fatalf("unexpected response: %q", out)
	}
	t.Logf("groq ok: %q", strings.TrimSpace(out))
}

//go:build staging

package stagingapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

func resolveAuthToken(cfg envConfig) (string, error) {
	if cfg.AuthToken != "" {
		return cfg.AuthToken, nil
	}
	if cfg.DatabaseURL == "" {
		return "", fmt.Errorf("set STAGING_AUTH_TOKEN, or DATABASE_URL (+ optional STAGING_USER_ID) to mint a session")
	}
	secret := cfg.SessionSecret
	if secret == "" {
		secret = "kitchenai-dev-session-secret"
	}
	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		return "", err
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		return "", fmt.Errorf("ping DATABASE_URL: %w", err)
	}

	userID := cfg.UserID
	if userID == "" {
		// Local convenience: pick any existing user when USER_ID is unset.
		if !isLocalBase(cfg.BaseURL) {
			return "", fmt.Errorf("set STAGING_AUTH_TOKEN or STAGING_USER_ID (with DATABASE_URL) to mint a session")
		}
		userID, err = pickAnyUserID(db)
		if err != nil {
			return "", err
		}
		_, _ = fmt.Fprintf(os.Stderr, "stagingapi auth: using local user %s\n", userID)
	}
	return mintSessionToken(db, secret, userID)
}

func pickAnyUserID(db *sql.DB) (string, error) {
	var id string
	err := db.QueryRow(`SELECT user_id::text FROM users ORDER BY created_at ASC NULLS LAST LIMIT 1`).Scan(&id)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("no users in DATABASE_URL — create a user via Google login first")
	}
	if err != nil {
		return "", fmt.Errorf("lookup user: %w", err)
	}
	return id, nil
}

func mintSessionToken(db *sql.DB, secret, userID string) (string, error) {
	sessionID := uuid.New().String()
	expires := time.Now().Add(24 * time.Hour)
	_, err := db.Exec(`
		INSERT INTO auth_sessions (session_id, user_id, provider, expires_at)
		VALUES ($1, $2, 'google', $3)
	`, sessionID, userID, expires)
	if err != nil {
		return "", fmt.Errorf("insert auth_sessions: %w", err)
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]any{
		"sid": sessionID,
		"exp": expires.Unix(),
		"iat": time.Now().Unix(),
	})
	if err != nil {
		return "", err
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	signingInput := header + "." + payloadB64
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig, nil
}

func loadDotEnv() {
	// go test runs with cwd = package dir (tests/stagingapi); walk up for backend/.env.
	candidates := []string{".env", "backend/.env"}
	if wd, err := os.Getwd(); err == nil {
		dir := wd
		for i := 0; i < 6; i++ {
			candidates = append(candidates, filepath.Join(dir, ".env"))
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	for _, p := range candidates {
		if err := godotenv.Load(p); err == nil {
			_, _ = fmt.Fprintf(os.Stderr, "stagingapi env: loaded %s\n", p)
			return
		}
	}
}

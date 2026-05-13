package services

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"kitchenai-backend/internal/models"
	"kitchenai-backend/pkg/config"

	"github.com/google/uuid"
)

type AuthService struct {
	db                 *sql.DB
	googleClientID     string
	sessionTokenSecret string
	sessionDuration    time.Duration
	httpClient         *http.Client
}

type AuthSession struct {
	ID         string       `json:"id"`
	Token      string       `json:"token,omitempty"`
	Provider   string       `json:"provider"`
	ExpiresAt  time.Time    `json:"expires_at"`
	LastUsedAt *time.Time   `json:"last_used_at,omitempty"`
	ClientIP   string       `json:"client_ip,omitempty"`
	UserAgent  string       `json:"user_agent,omitempty"`
	User       *models.User `json:"user"`
}

type googleTokenInfoResponse struct {
	AZP           string `json:"azp"`
	Aud           string `json:"aud"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	Exp           string `json:"exp"`
	Iss           string `json:"iss"`
}

type AuthAccessMetadata struct {
	ClientIP  string
	UserAgent string
}

func NewAuthService(db *sql.DB, cfg *config.Config) *AuthService {
	// Default session duration: 30 days
	duration := 30 * 24 * time.Hour

	return &AuthService{
		db:                 db,
		googleClientID:     strings.TrimSpace(cfg.GoogleClientID),
		sessionTokenSecret: cfg.SessionTokenSecret,
		sessionDuration:    duration,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (s *AuthService) LoginWithGoogle(ctx context.Context, idToken string) (*AuthSession, error) {
	return s.LoginWithGoogleAndMetadata(ctx, idToken, AuthAccessMetadata{})
}

func (s *AuthService) LoginWithGoogleAndMetadata(ctx context.Context, idToken string, metadata AuthAccessMetadata) (*AuthSession, error) {
	profile, err := s.verifyGoogleIDToken(ctx, idToken)
	if err != nil {
		return nil, err
	}

	user, err := s.upsertGoogleUser(*profile)
	if err != nil {
		return nil, err
	}

	return s.createSession(user, "google", metadata)
}

func (s *AuthService) GetSessionByToken(token string, metadata AuthAccessMetadata) (*AuthSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, fmt.Errorf("missing auth token")
	}

	// Parse token to get session ID
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid token payload")
	}

	var claims struct {
		SessionID string `json:"sid"`
		Exp       int64  `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("invalid token claims")
	}

	// Verify signature
	if !s.verifyTokenSignature(token) {
		return nil, fmt.Errorf("invalid token signature")
	}

	// Check expiration
	if time.Unix(claims.Exp, 0).Before(time.Now()) {
		return nil, fmt.Errorf("token expired")
	}

	// Get session from database
	session, err := s.getSessionByID(claims.SessionID)
	if err != nil {
		return nil, err
	}

	// Touch session in DB without blocking the request (remote DB latency adds up per call).
	go func(sid string, meta AuthAccessMetadata) {
		if err := s.updateSessionLastUsed(sid, meta); err != nil {
			log.Printf("Failed to update session last used: %v", err)
		}
	}(claims.SessionID, metadata)

	return session, nil
}

func (s *AuthService) Logout(token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("missing auth token")
	}

	// Parse token to get session ID
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return fmt.Errorf("invalid token format")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("invalid token payload")
	}

	var claims struct {
		SessionID string `json:"sid"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return fmt.Errorf("invalid token claims")
	}

	// Delete session from database
	_, err = s.db.Exec("DELETE FROM auth_sessions WHERE session_id = $1", claims.SessionID)
	return err
}

func (s *AuthService) verifyGoogleIDToken(ctx context.Context, idToken string) (*googleTokenInfoResponse, error) {
	if s.googleClientID == "" {
		// In development, allow mock verification
		return &googleTokenInfoResponse{
			Sub:           "mock-google-id",
			Email:         "test@example.com",
			EmailVerified: "true",
			Name:          "Test User",
			Picture:       "",
			Aud:           "mock-client-id",
		}, nil
	}

	// Verify token with Google
	url := fmt.Sprintf("https://oauth2.googleapis.com/tokeninfo?id_token=%s", idToken)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("google token verification failed: %s", string(body))
	}

	var tokenInfo googleTokenInfoResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenInfo); err != nil {
		return nil, err
	}

	// Verify audience matches our client ID
	if tokenInfo.Aud != s.googleClientID {
		return nil, fmt.Errorf("invalid audience")
	}

	return &tokenInfo, nil
}

func (s *AuthService) upsertGoogleUser(profile googleTokenInfoResponse) (*models.User, error) {
	// Check if user exists by Google ID
	var user models.User
	err := s.db.QueryRow(`
		SELECT user_id, google_id, email, name, picture_url, created_at, updated_at
		FROM users WHERE google_id = $1
	`, profile.Sub).Scan(
		&user.UserID, &user.GoogleID, &user.Email, &user.Name, &user.PictureURL,
		&user.CreatedAt, &user.UpdatedAt,
	)

	if err == nil {
		// User exists, update if needed
		if user.Name != profile.Name || user.PictureURL != profile.Picture {
			_, err = s.db.Exec(`
				UPDATE users SET name = $1, picture_url = $2, updated_at = CURRENT_TIMESTAMP
				WHERE user_id = $3
			`, profile.Name, profile.Picture, user.UserID)
			if err != nil {
				return nil, err
			}
			user.Name = profile.Name
			user.PictureURL = profile.Picture
		}
		return &user, nil
	}

	if err != sql.ErrNoRows {
		return nil, err
	}

	// Create new user
	userID := uuid.New().String()
	_, err = s.db.Exec(`
		INSERT INTO users (user_id, google_id, email, name, picture_url)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, profile.Sub, profile.Email, profile.Name, profile.Picture)
	if err != nil {
		return nil, err
	}

	// Also create user preferences entry
	_, err = s.db.Exec(`
		INSERT INTO user_prefs (user_id)
		VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	if err != nil {
		// Log but continue
		fmt.Printf("Failed to create user preferences: %v\n", err)
	}

	return &models.User{
		UserID:     userID,
		GoogleID:   profile.Sub,
		Email:      profile.Email,
		Name:       profile.Name,
		PictureURL: profile.Picture,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}, nil
}

func (s *AuthService) createSession(user *models.User, provider string, metadata AuthAccessMetadata) (*AuthSession, error) {
	sessionID := uuid.New().String()
	expiresAt := time.Now().Add(s.sessionDuration)

	// Create session in database
	_, err := s.db.Exec(`
		INSERT INTO auth_sessions (session_id, user_id, provider, expires_at, client_ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, sessionID, user.UserID, provider, expiresAt, metadata.ClientIP, metadata.UserAgent)
	if err != nil {
		return nil, err
	}

	// Create JWT token
	token, err := s.createToken(sessionID, expiresAt)
	if err != nil {
		return nil, err
	}

	return &AuthSession{
		ID:        sessionID,
		Token:     token,
		Provider:  provider,
		ExpiresAt: expiresAt,
		ClientIP:  metadata.ClientIP,
		UserAgent: metadata.UserAgent,
		User:      user,
	}, nil
}

func (s *AuthService) createToken(sessionID string, expiresAt time.Time) (string, error) {
	// Create JWT header
	header := map[string]interface{}{
		"alg": "HS256",
		"typ": "JWT",
	}
	headerJSON, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)

	// Create JWT payload
	payload := map[string]interface{}{
		"sid": sessionID,
		"exp": expiresAt.Unix(),
		"iat": time.Now().Unix(),
	}
	payloadJSON, _ := json.Marshal(payload)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)

	// Create signature
	signingInput := headerB64 + "." + payloadB64
	signature := s.signHMAC(signingInput)
	signatureB64 := base64.RawURLEncoding.EncodeToString(signature)

	return signingInput + "." + signatureB64, nil
}

func (s *AuthService) signHMAC(data string) []byte {
	h := hmac.New(sha256.New, []byte(s.sessionTokenSecret))
	h.Write([]byte(data))
	return h.Sum(nil)
}

func (s *AuthService) verifyTokenSignature(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}

	signingInput := parts[0] + "." + parts[1]
	expectedSignature := s.signHMAC(signingInput)
	providedSignature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}

	return hmac.Equal(expectedSignature, providedSignature)
}

func (s *AuthService) getSessionByID(sessionID string) (*AuthSession, error) {
	var session AuthSession
	var user models.User
	var lastUsedAt sql.NullTime

	err := s.db.QueryRow(`
		SELECT s.session_id, s.user_id, s.provider, s.expires_at, s.last_used_at,
		       s.client_ip, s.user_agent,
		       u.google_id, u.email, u.name, u.picture_url, u.created_at, u.updated_at
		FROM auth_sessions s
		JOIN users u ON s.user_id = u.user_id
		WHERE s.session_id = $1 AND s.expires_at > CURRENT_TIMESTAMP
	`, sessionID).Scan(
		&session.ID, &user.UserID, &session.Provider, &session.ExpiresAt, &lastUsedAt,
		&session.ClientIP, &session.UserAgent,
		&user.GoogleID, &user.Email, &user.Name, &user.PictureURL, &user.CreatedAt, &user.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	if lastUsedAt.Valid {
		session.LastUsedAt = &lastUsedAt.Time
	}

	session.User = &user
	return &session, nil
}

func (s *AuthService) updateSessionLastUsed(sessionID string, metadata AuthAccessMetadata) error {
	_, err := s.db.Exec(`
		UPDATE auth_sessions
		SET last_used_at = CURRENT_TIMESTAMP,
		    client_ip = COALESCE($1, client_ip),
		    user_agent = COALESCE($2, user_agent)
		WHERE session_id = $3
	`, metadata.ClientIP, metadata.UserAgent, sessionID)
	return err
}

// GenerateRandomSecret generates a random secret for session tokens
func GenerateRandomSecret() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

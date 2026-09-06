package services

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/lib/pq"

	"kitchenai-backend/pkg/config"
)

const expoPushBatchSize = 100

const androidMarketingChannelID = "marketing"

// PushAudience selects who receives a campaign.
type PushAudience string

const (
	PushAudienceMarketing PushAudience = "marketing"
	PushAudienceUser      PushAudience = "user"
	PushAudienceTest      PushAudience = "test"
)

// PushMessage is the payload sent to devices.
type PushMessage struct {
	Title string
	Body  string
	Data  map[string]string
}

// PushSendResult summarizes an Expo broadcast.
type PushSendResult struct {
	LogID           string `json:"log_id"`
	TokensTargeted  int    `json:"tokens_targeted"`
	TicketsOK       int    `json:"tickets_ok"`
	TicketsError    int    `json:"tickets_error"`
	InvalidRemoved  int    `json:"invalid_tokens_removed"`
}

// PushNotificationService stores device tokens and sends Expo push messages.
type PushNotificationService struct {
	db  *sql.DB
	cfg *config.Config
}

func NewPushNotificationService(db *sql.DB, cfg *config.Config) *PushNotificationService {
	return &PushNotificationService{db: db, cfg: cfg}
}

type PushPreferences struct {
	MarketingEnabled bool `json:"marketing_enabled"`
}

func (s *PushNotificationService) GetPreferences(ctx context.Context, userID string) (PushPreferences, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return PushPreferences{}, fmt.Errorf("user_id required")
	}
	var enabled bool
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(marketing_push_enabled, TRUE)
		FROM users WHERE user_id = $1
	`, userID).Scan(&enabled)
	if err == sql.ErrNoRows {
		return PushPreferences{MarketingEnabled: true}, nil
	}
	if err != nil {
		return PushPreferences{}, err
	}
	return PushPreferences{MarketingEnabled: enabled}, nil
}

func (s *PushNotificationService) SetMarketingEnabled(ctx context.Context, userID string, enabled bool) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("user_id required")
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE users SET marketing_push_enabled = $2, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1
	`, userID, enabled)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

// UpsertPushToken registers or refreshes a device Expo push token for the user.
func (s *PushNotificationService) UpsertPushToken(ctx context.Context, userID, expoToken, platform, deviceID string) error {
	userID = strings.TrimSpace(userID)
	expoToken = strings.TrimSpace(expoToken)
	platform = strings.ToLower(strings.TrimSpace(platform))
	deviceID = strings.TrimSpace(deviceID)
	if userID == "" || expoToken == "" {
		return fmt.Errorf("user_id and expo_push_token required")
	}
	if !isValidExpoPushToken(expoToken) {
		return fmt.Errorf("invalid expo push token")
	}
	if platform != "ios" && platform != "android" {
		return fmt.Errorf("platform must be ios or android")
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO device_push_tokens (user_id, expo_push_token, platform, device_id, updated_at)
		VALUES ($1, $2, $3, NULLIF($4, ''), CURRENT_TIMESTAMP)
		ON CONFLICT (expo_push_token) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			platform = EXCLUDED.platform,
			device_id = COALESCE(NULLIF(EXCLUDED.device_id, ''), device_push_tokens.device_id),
			updated_at = CURRENT_TIMESTAMP
	`, userID, expoToken, platform, deviceID)
	return err
}

// DeletePushToken removes a token (e.g. on logout).
func (s *PushNotificationService) DeletePushToken(ctx context.Context, userID, expoToken string) error {
	userID = strings.TrimSpace(userID)
	expoToken = strings.TrimSpace(expoToken)
	if userID == "" || expoToken == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM device_push_tokens
		WHERE user_id = $1 AND expo_push_token = $2
	`, userID, expoToken)
	return err
}

// SendMarketingBroadcast sends to all users with marketing_push_enabled and a registered token.
func (s *PushNotificationService) SendMarketingBroadcast(ctx context.Context, msg PushMessage, campaignKey, createdByEmail string) (*PushSendResult, error) {
	return s.sendToTokens(ctx, msg, PushAudienceMarketing, campaignKey, createdByEmail, "", s.listMarketingTokens)
}

// SendToUser sends to all tokens for one user (ignores marketing opt-out).
func (s *PushNotificationService) SendToUser(ctx context.Context, userID string, msg PushMessage, campaignKey, createdByEmail string) (*PushSendResult, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("user_id required")
	}
	return s.sendToTokens(ctx, msg, PushAudienceUser, campaignKey, createdByEmail, userID, func(ctx context.Context) ([]string, error) {
		return s.listTokensForUser(ctx, userID)
	})
}

type tokenLister func(ctx context.Context) ([]string, error)

func (s *PushNotificationService) sendToTokens(
	ctx context.Context,
	msg PushMessage,
	audience PushAudience,
	campaignKey, createdByEmail, targetUserID string,
	list tokenLister,
) (*PushSendResult, error) {
	if strings.TrimSpace(msg.Title) == "" || strings.TrimSpace(msg.Body) == "" {
		return nil, fmt.Errorf("title and body required")
	}
	if s.cfg == nil || !s.cfg.ExpoPushConfigured() {
		return nil, fmt.Errorf("EXPO_ACCESS_TOKEN is not configured on the server")
	}

	tokens, err := list(ctx)
	if err != nil {
		return nil, err
	}
	if len(tokens) == 0 {
		return &PushSendResult{}, nil
	}

	data := msg.Data
	if data == nil {
		data = map[string]string{"type": "marketing"}
	}
	if _, ok := data["type"]; !ok {
		data["type"] = "marketing"
	}

	var ticketsOK, ticketsError, invalidRemoved int
	var invalidTokens []string
	for i := 0; i < len(tokens); i += expoPushBatchSize {
		end := i + expoPushBatchSize
		if end > len(tokens) {
			end = len(tokens)
		}
		batch := tokens[i:end]
		results, err := sendExpoPushBatch(ctx, s.cfg.ExpoAccessToken, batch, msg.Title, msg.Body, data, androidMarketingChannelID)
		if err != nil {
			return nil, err
		}
		for j, r := range results {
			if r.Status == "ok" {
				ticketsOK++
				continue
			}
			ticketsError++
			if r.isDeviceNotRegistered() {
				invalidTokens = append(invalidTokens, batch[j])
			}
		}
	}
	if len(invalidTokens) > 0 {
		invalidRemoved, _ = s.deleteTokens(ctx, invalidTokens)
	}

	logID, err := s.insertPushLog(ctx, campaignKey, msg.Title, msg.Body, string(audience), targetUserID, len(tokens), ticketsOK, ticketsError, createdByEmail)
	if err != nil {
		return nil, err
	}

	return &PushSendResult{
		LogID:          logID,
		TokensTargeted: len(tokens),
		TicketsOK:      ticketsOK,
		TicketsError:   ticketsError,
		InvalidRemoved: invalidRemoved,
	}, nil
}

func (s *PushNotificationService) listMarketingTokens(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT t.expo_push_token
		FROM device_push_tokens t
		JOIN users u ON u.user_id = t.user_id
		WHERE u.marketing_push_enabled = TRUE
		ORDER BY t.expo_push_token
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTokenRows(rows)
}

func (s *PushNotificationService) listTokensForUser(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT expo_push_token FROM device_push_tokens
		WHERE user_id = $1
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTokenRows(rows)
}

func scanTokenRows(rows *sql.Rows) ([]string, error) {
	var out []string
	for rows.Next() {
		var tok string
		if err := rows.Scan(&tok); err != nil {
			return nil, err
		}
		if isValidExpoPushToken(tok) {
			out = append(out, tok)
		}
	}
	return out, rows.Err()
}

func (s *PushNotificationService) deleteTokens(ctx context.Context, tokens []string) (int, error) {
	if len(tokens) == 0 {
		return 0, nil
	}
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM device_push_tokens WHERE expo_push_token = ANY($1)
	`, pq.Array(tokens))
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *PushNotificationService) insertPushLog(
	ctx context.Context,
	campaignKey, title, body, audience, targetUserID string,
	targeted, ok, errCount int,
	createdByEmail string,
) (string, error) {
	var logID string
	var target interface{}
	if strings.TrimSpace(targetUserID) != "" {
		target = targetUserID
	}
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO push_notification_log (
			campaign_key, title, body, audience, target_user_id,
			tokens_targeted, tickets_ok, tickets_error, created_by_email
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id::text
	`, nullIfEmpty(campaignKey), title, body, audience, target, targeted, ok, errCount, nullIfEmpty(createdByEmail)).Scan(&logID)
	return logID, err
}

func nullIfEmpty(s string) interface{} {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return s
}

func isValidExpoPushToken(token string) bool {
	token = strings.TrimSpace(token)
	return strings.HasPrefix(token, "ExponentPushToken[") || strings.HasPrefix(token, "ExpoPushToken[")
}

// ResolveUserIDByEmail finds a user id for panel test sends.
func (s *PushNotificationService) ResolveUserIDByEmail(ctx context.Context, email string) (string, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return "", fmt.Errorf("email required")
	}
	var userID string
	err := s.db.QueryRowContext(ctx, `
		SELECT user_id::text FROM users WHERE LOWER(email) = LOWER($1)
	`, email).Scan(&userID)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("user not found")
	}
	return userID, err
}

// TouchTokenUpdatedAt helps debug stale tokens.
func (s *PushNotificationService) CountRegisteredTokens(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM device_push_tokens`).Scan(&n)
	return n, err
}

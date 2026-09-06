package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const expoPushAPIURL = "https://exp.host/--/api/v2/push/send"

type expoPushTicket struct {
	Status  string `json:"status"`
	ID      string `json:"id,omitempty"`
	Message string `json:"message,omitempty"`
	Details *struct {
		Error string `json:"error"`
	} `json:"details,omitempty"`
}

func (t expoPushTicket) isDeviceNotRegistered() bool {
	if t.Details != nil && strings.EqualFold(t.Details.Error, "DeviceNotRegistered") {
		return true
	}
	return strings.Contains(strings.ToLower(t.Message), "devicenotregistered")
}

type expoPushResponse struct {
	Data []expoPushTicket `json:"data"`
}

func sendExpoPushBatch(
	ctx context.Context,
	accessToken string,
	tokens []string,
	title, body string,
	data map[string]string,
	androidChannelID string,
) ([]expoPushTicket, error) {
	if len(tokens) == 0 {
		return nil, nil
	}

	messages := make([]map[string]interface{}, 0, len(tokens))
	for _, tok := range tokens {
		msg := map[string]interface{}{
			"to":    tok,
			"title": title,
			"body":  body,
			"sound": "default",
			"data":  data,
		}
		if androidChannelID != "" {
			msg["channelId"] = androidChannelID
		}
		messages = append(messages, msg)
	}

	raw, err := json.Marshal(messages)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushAPIURL, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if strings.TrimSpace(accessToken) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("expo push HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}

	var parsed expoPushResponse
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		return nil, fmt.Errorf("expo push response: %w", err)
	}
	if len(parsed.Data) != len(tokens) {
		return nil, fmt.Errorf("expo push ticket count mismatch")
	}
	return parsed.Data, nil
}

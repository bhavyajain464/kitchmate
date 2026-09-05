package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"kitchenai-backend/internal/middleware"
	"kitchenai-backend/internal/services"
)

type registerPushTokenRequest struct {
	ExpoPushToken string `json:"expo_push_token"`
	Platform      string `json:"platform"`
	DeviceID      string `json:"device_id,omitempty"`
}

type marketingPushPatchRequest struct {
	MarketingEnabled bool `json:"marketing_enabled"`
}

// RegisterPushToken POST /notifications/push-token
func RegisterPushToken(svc *services.PushNotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req registerPushTokenRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if err := svc.UpsertPushToken(r.Context(), userID, req.ExpoPushToken, req.Platform, req.DeviceID); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "registered"})
	}
}

// DeletePushToken DELETE /notifications/push-token
func DeletePushToken(svc *services.PushNotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req registerPushTokenRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		_ = svc.DeletePushToken(r.Context(), userID, req.ExpoPushToken)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	}
}

// GetPushPreferences GET /notifications/preferences
func GetPushPreferences(svc *services.PushNotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		prefs, err := svc.GetPreferences(r.Context(), userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(prefs)
	}
}

// UpdatePushPreferences PUT /notifications/preferences
func UpdatePushPreferences(svc *services.PushNotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req marketingPushPatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if err := svc.SetMarketingEnabled(r.Context(), userID, req.MarketingEnabled); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		prefs, err := svc.GetPreferences(r.Context(), userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(prefs)
	}
}

type panelSendPushRequest struct {
	Title        string `json:"title"`
	Body         string `json:"body"`
	Screen       string `json:"screen,omitempty"`
	CampaignKey  string `json:"campaign_key,omitempty"`
	UserID       string `json:"user_id,omitempty"`
	UserEmail    string `json:"user_email,omitempty"`
	Broadcast    bool   `json:"broadcast"`
}

// PanelSendPush POST /panel/push/send — marketing broadcast or single-user send.
func PanelSendPush(svc *services.PushNotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req panelSendPushRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		createdBy := strings.TrimSpace(middleware.PanelAdminEmail(r))

		data := map[string]string{"type": "marketing"}
		if screen := strings.TrimSpace(req.Screen); screen != "" {
			data["screen"] = screen
		}
		msg := services.PushMessage{
			Title: strings.TrimSpace(req.Title),
			Body:  strings.TrimSpace(req.Body),
			Data:  data,
		}

		var result *services.PushSendResult
		var err error
		if req.Broadcast {
			result, err = svc.SendMarketingBroadcast(r.Context(), msg, req.CampaignKey, createdBy)
		} else {
			userID := strings.TrimSpace(req.UserID)
			if userID == "" && strings.TrimSpace(req.UserEmail) != "" {
				userID, err = svc.ResolveUserIDByEmail(r.Context(), req.UserEmail)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
			}
			if userID == "" {
				http.Error(w, "user_id or user_email required when broadcast is false", http.StatusBadRequest)
				return
			}
			result, err = svc.SendToUser(r.Context(), userID, msg, req.CampaignKey, createdBy)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"kitchenai-backend/internal/services"
)

type dietAnalysisPatchRequest struct {
	EmailEnabled bool `json:"email_enabled"`
}

// GetDietAnalysisSettings returns diet email preferences.
func GetDietAnalysisSettings(svc *services.DietDigestService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		settings, err := svc.GetSettings(r.Context(), userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(settings)
	}
}

// UpdateDietAnalysisSettings toggles weekly diet email (Elite only).
func UpdateDietAnalysisSettings(svc *services.DietDigestService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		var req dietAnalysisPatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if err := svc.SetEmailEnabled(r.Context(), userID, req.EmailEnabled); err != nil {
			if strings.Contains(err.Error(), "Elite") {
				http.Error(w, err.Error(), http.StatusPaymentRequired)
				return
			}
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		settings, err := svc.GetSettings(r.Context(), userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(settings)
	}
}

// SendDietDigestTest emails the weekly log summary for the week containing date (Elite + enabled).
// Optional query: ?date=YYYY-MM-DD (defaults to yesterday's week in Asia/Kolkata).
func SendDietDigestTest(svc *services.DietDigestService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		loc, _ := time.LoadLocation("Asia/Kolkata")
		if loc == nil {
			loc = time.UTC
		}
		dateISO := strings.TrimSpace(r.URL.Query().Get("date"))
		if dateISO == "" {
			dateISO = time.Now().In(loc).AddDate(0, 0, -1).Format("2006-01-02")
		} else if _, err := time.Parse("2006-01-02", dateISO); err != nil {
			http.Error(w, "date must be YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		if err := svc.SendDigestForUser(r.Context(), userID, dateISO); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "sent",
			"date":   dateISO,
		})
	}
}

// GetDietDayReport returns AI nutrition analysis for logged meals on a calendar day (Elite).
// Query: ?date=YYYY-MM-DD (defaults to today in Asia/Kolkata).
func GetDietDayReport(svc *services.DietDigestService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		loc, _ := time.LoadLocation("Asia/Kolkata")
		if loc == nil {
			loc = time.UTC
		}
		dateISO := strings.TrimSpace(r.URL.Query().Get("date"))
		if dateISO == "" {
			dateISO = time.Now().In(loc).Format("2006-01-02")
		} else if _, err := time.Parse("2006-01-02", dateISO); err != nil {
			http.Error(w, "date must be YYYY-MM-DD", http.StatusBadRequest)
			return
		}

		resp, err := svc.BuildDayReport(r.Context(), userID, dateISO)
		if err != nil {
			msg := err.Error()
			if strings.Contains(msg, "Elite") || strings.Contains(msg, "diet analysis") {
				writeUpgradeRequired(w, "diet_analysis", msg)
				return
			}
			http.Error(w, msg, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

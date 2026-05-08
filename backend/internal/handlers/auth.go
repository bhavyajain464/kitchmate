package handlers

import (
	"encoding/json"
	"net/http"

	"kitchenai-backend/internal/services"

	"github.com/gorilla/mux"
)

type AuthHandler struct {
	authService *services.AuthService
}

type GoogleLoginRequest struct {
	Credential string `json:"credential"`
}

func NewAuthHandler(authService *services.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	// Only accept POST requests
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req GoogleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Credential == "" {
		http.Error(w, "Google credential is required", http.StatusBadRequest)
		return
	}

	session, err := h.authService.LoginWithGoogleAndMetadata(r.Context(), req.Credential, services.AuthAccessMetadata{
		ClientIP:  getClientIP(r),
		UserAgent: r.UserAgent(),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":      session.Token,
		"expires_at": session.ExpiresAt,
		"user":       session.User,
		"provider":   session.Provider,
	})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	// Only accept GET requests
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	session := getAuthSession(r)
	if session == nil {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":       session.User,
		"provider":   session.Provider,
		"expires_at": session.ExpiresAt,
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// Only accept POST requests
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := getAuthToken(r)
	if token == "" {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	if err := h.authService.Logout(token); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Logged out successfully",
	})
}

// Helper functions
func getClientIP(r *http.Request) string {
	// Get IP from X-Forwarded-For header if behind proxy
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return forwarded
	}
	return r.RemoteAddr
}

func getAuthToken(r *http.Request) string {
	// Try to get token from Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" && len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:]
	}

	// Try to get token from query parameter
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}

	// Try to get token from cookie
	if cookie, err := r.Cookie("auth_token"); err == nil {
		return cookie.Value
	}

	return ""
}

func getAuthSession(r *http.Request) *services.AuthSession {
	// Get session from context (set by auth middleware)
	if session, ok := r.Context().Value("auth_session").(*services.AuthSession); ok {
		return session
	}
	return nil
}

// RegisterAuthRoutes registers authentication routes
func RegisterAuthRoutes(router *mux.Router, authService *services.AuthService) {
	authHandler := NewAuthHandler(authService)

	router.HandleFunc("/api/auth/google", authHandler.GoogleLogin).Methods("POST")
	router.HandleFunc("/api/auth/me", authHandler.Me).Methods("GET")
	router.HandleFunc("/api/auth/logout", authHandler.Logout).Methods("POST")
}

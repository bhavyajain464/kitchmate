package middleware

import (
	"context"
	"net/http"

	"kitchenai-backend/internal/services"
)

type contextKey string

const (
	authSessionKey contextKey = "auth_session"
	authTokenKey   contextKey = "auth_token"
)

// AuthMiddleware creates middleware that authenticates requests
func AuthMiddleware(authService *services.AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Get token from request
			token := getAuthToken(r)

			if token == "" {
				// No token, continue without authentication
				next.ServeHTTP(w, r)
				return
			}

			// Verify token and get session
			session, err := authService.GetSessionByToken(token, services.AuthAccessMetadata{
				ClientIP:  getClientIP(r),
				UserAgent: r.UserAgent(),
			})

			if err != nil {
				// Invalid token, continue without authentication
				// Don't return error to allow public routes
				next.ServeHTTP(w, r)
				return
			}

			// Add session and token to context
			ctx := r.Context()
			ctx = context.WithValue(ctx, authSessionKey, session)
			ctx = context.WithValue(ctx, authTokenKey, token)

			// Continue with authenticated request
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAuth creates middleware that requires authentication
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := GetAuthSession(r)
		if session == nil {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GetAuthSession retrieves the auth session from request context
func GetAuthSession(r *http.Request) *services.AuthSession {
	if session, ok := r.Context().Value(authSessionKey).(*services.AuthSession); ok {
		return session
	}
	return nil
}

// GetAuthToken retrieves the auth token from request context
func GetAuthToken(r *http.Request) string {
	if token, ok := r.Context().Value(authTokenKey).(string); ok {
		return token
	}
	return ""
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

package middleware

import (
	"log"
	"net/http"
)

// CORS wraps the root HTTP handler so preflight and error responses (404/405)
// still include Access-Control-* headers. gorilla/mux router.Use() only runs
// middleware for matched routes, which breaks browser preflight on unknown paths.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s (Origin: %s)", r.Method, r.URL.Path, r.Header.Get("Origin"))

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Razorpay-Signature, X-Admin-Key, X-App-Platform, X-App-Version, X-App-Build, X-Zomato-Worker-Secret")
		w.Header().Set("Access-Control-Max-Age", "300")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

package main

import (
	"log"
	"net/http"
	"time"

	"kitchenai-backend/internal/db"
	"kitchenai-backend/internal/handlers"
	"kitchenai-backend/internal/middleware"
	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"

	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize database connection
	database, err := db.InitDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	sqlDB := database.GetDB()

	// Initialize services
	authService := services.NewAuthService(sqlDB, cfg)
	whatsappService := services.NewWhatsAppService(cfg, sqlDB)

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(authService)

	// Initialize router
	router := mux.NewRouter()

	// Apply auth middleware to all API routes
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(middleware.AuthMiddleware(authService))

	// Public routes (no auth required)
	api.HandleFunc("/auth/google-login", authHandler.GoogleLogin).Methods("POST")
	api.HandleFunc("/auth/me", authHandler.Me).Methods("GET")
	api.HandleFunc("/auth/logout", authHandler.Logout).Methods("POST")

	// Inventory routes (require auth)
	api.Handle("/inventory", middleware.RequireAuth(http.HandlerFunc(handlers.GetInventory(sqlDB)))).Methods("GET")
	api.Handle("/inventory", middleware.RequireAuth(http.HandlerFunc(handlers.CreateInventoryItem(sqlDB)))).Methods("POST")
	api.Handle("/inventory/{id}", middleware.RequireAuth(http.HandlerFunc(handlers.GetInventoryItem(sqlDB)))).Methods("GET")
	api.Handle("/inventory/{id}", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateInventoryItem(sqlDB)))).Methods("PUT")
	api.Handle("/inventory/{id}", middleware.RequireAuth(http.HandlerFunc(handlers.DeleteInventoryItem(sqlDB)))).Methods("DELETE")
	api.Handle("/inventory/expiring", middleware.RequireAuth(http.HandlerFunc(handlers.GetExpiringItems(sqlDB)))).Methods("GET")

	// User preferences routes (require auth)
	api.Handle("/user/preferences", middleware.RequireAuth(http.HandlerFunc(handlers.GetUserPreferences(sqlDB)))).Methods("GET")
	api.Handle("/user/preferences", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateUserPreferences(sqlDB)))).Methods("PUT")

	// Cook profile routes (require auth)
	api.Handle("/cook/profile", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookProfile(sqlDB)))).Methods("GET")
	api.Handle("/cook/profile", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateCookProfile(sqlDB)))).Methods("PUT")

	// Bill scanning routes (Week 2 - Vision Engine) (require auth)
	api.Handle("/bill/scan", middleware.RequireAuth(http.HandlerFunc(handlers.ScanBill(sqlDB, cfg)))).Methods("POST")
	api.Handle("/bill/scan/upload", middleware.RequireAuth(http.HandlerFunc(handlers.ScanBillMultipart(sqlDB, cfg)))).Methods("POST")
	api.Handle("/bill/scan/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestScanBill(sqlDB)))).Methods("GET")

	// WhatsApp integration routes (Week 3 - Cook Integration) (require auth)
	api.Handle("/whatsapp/send", middleware.RequireAuth(http.HandlerFunc(handlers.SendWhatsAppMessage(sqlDB, cfg)))).Methods("POST")
	api.Handle("/whatsapp/send-meal-suggestion", middleware.RequireAuth(http.HandlerFunc(handlers.SendMealSuggestionToCook(sqlDB, cfg)))).Methods("POST")
	api.Handle("/whatsapp/send-daily-menu", middleware.RequireAuth(http.HandlerFunc(handlers.SendDailyMenuToCook(sqlDB, cfg)))).Methods("POST")
	api.Handle("/whatsapp/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestWhatsAppIntegration(sqlDB, cfg)))).Methods("GET")
	api.Handle("/whatsapp/cook-info", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookWhatsAppInfo(sqlDB)))).Methods("GET")

	// Rescue meal routes (Week 4 - Reasoning Layer) (require auth)
	api.Handle("/rescue-meal/suggestions", middleware.RequireAuth(http.HandlerFunc(handlers.GetRescueMealSuggestions(sqlDB)))).Methods("GET", "POST", "OPTIONS")
	api.Handle("/rescue-meal/simple", middleware.RequireAuth(http.HandlerFunc(handlers.GetSimpleRescueMeal(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/rescue-meal/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestRescueMeal(sqlDB)))).Methods("GET")

	// Procurement routes (Week 5 - Intelligent Procurement)
	api.Handle("/procurement/shopping-list", middleware.RequireAuth(http.HandlerFunc(handlers.GetShoppingListHandler(sqlDB)))).Methods("GET", "POST", "OPTIONS")
	api.Handle("/procurement/low-stock", middleware.RequireAuth(http.HandlerFunc(handlers.GetLowStockItemsHandler(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/procurement/pre-market-ping", middleware.RequireAuth(http.HandlerFunc(handlers.SendPreMarketPingHandler(sqlDB, whatsappService)))).Methods("POST", "OPTIONS")
	api.Handle("/procurement/summary", middleware.RequireAuth(http.HandlerFunc(handlers.GetProcurementSummaryHandler(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/procurement/recent-lists", middleware.RequireAuth(http.HandlerFunc(handlers.GetRecentShoppingListsHandler(sqlDB)))).Methods("GET", "OPTIONS")

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status": "healthy", "service": "kitchenai-backend"}`))
	}).Methods("GET")

	// CORS configuration
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://localhost:19006", "http://localhost:19000", "http://localhost:8082", "http://192.168.0.116:19000", "http://192.168.0.116:19006", "http://192.168.0.116:8080", "http://192.168.0.116:8082", "exp://192.168.0.116:8082"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
		MaxAge:           300,
	})

	// Create server
	srv := &http.Server{
		Handler:      corsHandler.Handler(router),
		Addr:         ":" + cfg.Port,
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("Starting server on port %s", cfg.Port)
	log.Fatal(srv.ListenAndServe())
}

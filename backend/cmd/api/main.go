package main

import (
	"log"
	"net/http"
	"time"

	"github.com/joho/godotenv"

	"kitchenai-backend/internal/db"
	"kitchenai-backend/internal/handlers"
	kafkalib "kitchenai-backend/internal/kafka"
	"kitchenai-backend/internal/middleware"
	redislib "kitchenai-backend/internal/redis"
	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"

	"github.com/gorilla/mux"
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s (Origin: %s)", r.Method, r.URL.Path, r.Header.Get("Origin"))

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "300")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("no .env file loaded (%v); using process environment only", err)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	if err := cfg.ValidateKafkaAuth(); err != nil {
		log.Fatalf("Invalid Kafka config: %v", err)
	}

	database, err := db.InitDB(
		cfg.DatabaseURL,
		cfg.DatabaseMaxOpenConns,
		cfg.DatabaseMaxIdleConns,
		time.Duration(cfg.DatabaseConnMaxLifetimeMin)*time.Minute,
		time.Duration(cfg.DatabaseConnMaxIdleSec)*time.Second,
	)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	sqlDB := database.GetDB()

	if err := handlers.EnsureCookedLogSchema(sqlDB); err != nil {
		log.Printf("cooked_log schema ensure failed: %v", err)
	}

	redisClient := redislib.New(cfg)
	defer redisClient.Close()
	cookedLogSvc := services.NewCookedLogService(sqlDB, redisClient)

	authService := services.NewAuthService(sqlDB, cfg)
	authHandler := handlers.NewAuthHandler(authService)

	kafkaProducer := kafkalib.NewProducer(cfg)
	if kafkaProducer != nil {
		defer kafkaProducer.Close()
	}
	kafkalib.StartShelfLifeConsumer(sqlDB, cfg)

	router := mux.NewRouter()
	router.Use(corsMiddleware)

	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(middleware.AuthMiddleware(authService))

	// Public routes
	api.HandleFunc("/auth/google-login", authHandler.GoogleLogin).Methods("POST", "OPTIONS")
	api.HandleFunc("/auth/me", authHandler.Me).Methods("GET", "OPTIONS")
	api.HandleFunc("/auth/logout", authHandler.Logout).Methods("POST", "OPTIONS")

	// Inventory (specific paths before {id} wildcard)
	api.Handle("/inventory", middleware.RequireAuth(http.HandlerFunc(handlers.GetInventory(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/inventory", middleware.RequireAuth(http.HandlerFunc(handlers.CreateInventoryItem(sqlDB, kafkaProducer)))).Methods("POST")
	api.Handle("/inventory/expiring", middleware.RequireAuth(http.HandlerFunc(handlers.GetExpiringItems(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/inventory/expired", middleware.RequireAuth(http.HandlerFunc(handlers.GetExpiredItems(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/inventory/{id:[a-fA-F0-9-]+}", middleware.RequireAuth(http.HandlerFunc(handlers.GetInventoryItem(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/inventory/{id:[a-fA-F0-9-]+}", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateInventoryItem(sqlDB, kafkaProducer)))).Methods("PUT", "OPTIONS")
	api.Handle("/inventory/{id:[a-fA-F0-9-]+}/expire", middleware.RequireAuth(http.HandlerFunc(handlers.ExpireInventoryItem(sqlDB)))).Methods("PATCH", "OPTIONS")
	api.Handle("/inventory/{id:[a-fA-F0-9-]+}", middleware.RequireAuth(http.HandlerFunc(handlers.DeleteInventoryItem(sqlDB)))).Methods("DELETE", "OPTIONS")

	// User preferences
	api.Handle("/user/preferences", middleware.RequireAuth(http.HandlerFunc(handlers.GetUserPreferences(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/user/preferences", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateUserPreferences(sqlDB)))).Methods("PUT", "OPTIONS")

	// Onboarding
	api.Handle("/onboarding/status", middleware.RequireAuth(http.HandlerFunc(handlers.GetOnboardingStatus(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/onboarding/complete", middleware.RequireAuth(http.HandlerFunc(handlers.CompleteOnboarding(sqlDB, kafkaProducer)))).Methods("POST", "OPTIONS")

	// Profile & Memory
	api.Handle("/profile", middleware.RequireAuth(http.HandlerFunc(handlers.GetProfile(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/profile", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateProfile(sqlDB)))).Methods("PUT", "OPTIONS")
	api.Handle("/profile/memory", middleware.RequireAuth(http.HandlerFunc(handlers.AddMemory(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/profile/memory/{id}", middleware.RequireAuth(http.HandlerFunc(handlers.DeleteMemory(sqlDB)))).Methods("DELETE", "OPTIONS")

	// Cook profile
	api.Handle("/cook/profile", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookProfile(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/cook/profile", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateCookProfile(sqlDB)))).Methods("PUT", "OPTIONS")

	// Bill scanning
	api.Handle("/bill/scan", middleware.RequireAuth(http.HandlerFunc(handlers.ScanBill(sqlDB, cfg)))).Methods("POST", "OPTIONS")
	api.Handle("/bill/scan/upload", middleware.RequireAuth(http.HandlerFunc(handlers.ScanBillMultipart(sqlDB, cfg)))).Methods("POST", "OPTIONS")
	api.Handle("/bill/scan/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestScanBill(sqlDB)))).Methods("GET", "OPTIONS")

	// WhatsApp
	api.Handle("/whatsapp/send", middleware.RequireAuth(http.HandlerFunc(handlers.SendWhatsAppMessage(sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/send-meal-suggestion", middleware.RequireAuth(http.HandlerFunc(handlers.SendMealSuggestionToCook(sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/send-daily-menu", middleware.RequireAuth(http.HandlerFunc(handlers.SendDailyMenuToCook(sqlDB, cfg)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestWhatsAppIntegration(sqlDB, cfg)))).Methods("GET", "OPTIONS")
	api.Handle("/whatsapp/cook-info", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookWhatsAppInfo(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/whatsapp/parse", middleware.RequireAuth(http.HandlerFunc(handlers.ParseWhatsAppMessage(cfg)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/apply", middleware.RequireAuth(http.HandlerFunc(handlers.ApplyWhatsAppAction(sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")

	// Smart Meals & cooked history
	api.Handle("/meals/smart", middleware.RequireAuth(http.HandlerFunc(handlers.GetSmartMeals(sqlDB, cfg, cookedLogSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/cooked-history", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookedHistory(cookedLogSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/cooked", middleware.RequireAuth(http.HandlerFunc(handlers.LogCookedDish(cookedLogSvc)))).Methods("POST", "OPTIONS")

	// Legacy rescue meals
	api.Handle("/rescue-meal/suggestions", middleware.RequireAuth(http.HandlerFunc(handlers.GetRescueMealSuggestions(sqlDB)))).Methods("GET", "POST", "OPTIONS")
	api.Handle("/rescue-meal/simple", middleware.RequireAuth(http.HandlerFunc(handlers.GetSimpleRescueMeal(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/rescue-meal/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestRescueMeal(sqlDB)))).Methods("GET", "OPTIONS")

	// Shopping List
	api.Handle("/shopping", middleware.RequireAuth(http.HandlerFunc(handlers.GetShoppingItems(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/shopping", middleware.RequireAuth(http.HandlerFunc(handlers.AddShoppingItem(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/shopping/bulk", middleware.RequireAuth(http.HandlerFunc(handlers.AddBulkShoppingItems(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/shopping/{id}/toggle", middleware.RequireAuth(http.HandlerFunc(handlers.ToggleShoppingItem(sqlDB)))).Methods("PATCH", "OPTIONS")
	api.Handle("/shopping/{id}", middleware.RequireAuth(http.HandlerFunc(handlers.DeleteShoppingItem(sqlDB)))).Methods("DELETE", "OPTIONS")
	api.Handle("/shopping/clear-bought", middleware.RequireAuth(http.HandlerFunc(handlers.ClearBoughtItems(sqlDB)))).Methods("DELETE", "OPTIONS")

	// Procurement (legacy)
	api.Handle("/procurement/shopping-list", middleware.RequireAuth(http.HandlerFunc(handlers.GetShoppingListHandler(sqlDB)))).Methods("GET", "POST", "OPTIONS")
	api.Handle("/procurement/low-stock", middleware.RequireAuth(http.HandlerFunc(handlers.GetLowStockItemsHandler(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/procurement/pre-market-ping", middleware.RequireAuth(http.HandlerFunc(handlers.SendPreMarketPingHandler(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/procurement/summary", middleware.RequireAuth(http.HandlerFunc(handlers.GetProcurementSummaryHandler(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/procurement/recent-lists", middleware.RequireAuth(http.HandlerFunc(handlers.GetRecentShoppingListsHandler(sqlDB)))).Methods("GET", "OPTIONS")

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status": "healthy", "service": "kitchenai-backend", "version": "ci-1"}`))
	}).Methods("GET")

	srv := &http.Server{
		Handler:      router,
		Addr:         ":" + cfg.Port,
		WriteTimeout: 60 * time.Second,
		ReadTimeout:  15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("Starting server on port %s", cfg.Port)
	log.Fatal(srv.ListenAndServe())
}

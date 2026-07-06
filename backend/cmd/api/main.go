package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/joho/godotenv"

	"kitchenai-backend/internal/db"
	"kitchenai-backend/internal/handlers"
	kafkalib "kitchenai-backend/internal/kafka"
	"kitchenai-backend/internal/middleware"
	invpostgres "kitchenai-backend/internal/platform/inventory/postgres"
	kitchenpostgres "kitchenai-backend/internal/platform/kitchen/postgres"
	zomatosvc "kitchenai-backend/internal/restaurant/integrations/zomato"
	restauranthttp "kitchenai-backend/internal/restaurant/transport/http"
	restaurantsvc "kitchenai-backend/internal/restaurant/services"
	redislib "kitchenai-backend/internal/redis"
	"kitchenai-backend/internal/services"
	"kitchenai-backend/internal/services/catalogdb"
	"kitchenai-backend/internal/services/ingredients"
	"kitchenai-backend/pkg/config"

	"github.com/gorilla/mux"
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s (Origin: %s)", r.Method, r.URL.Path, r.Header.Get("Origin"))

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Razorpay-Signature, X-Admin-Key, X-App-Platform, X-App-Version, X-App-Build, X-Zomato-Worker-Secret")
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
	if cfg.Razorpay.Enabled() {
		log.Printf("Razorpay billing: env=%s currency=%s", cfg.Razorpay.Env, cfg.Razorpay.BillingCurrency)
	} else {
		log.Printf("Razorpay billing: disabled (set RAZORPAY_ENV and matching key pair to enable checkout)")
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

	ingredients.InitCatalog(sqlDB)
	catalogdb.Init(sqlDB)
	if n, err := catalogdb.BootstrapPairLabelAliases(context.Background(), sqlDB); err != nil {
		log.Printf("pair label alias bootstrap: %v", err)
	} else if n > 0 {
		log.Printf("bootstrapped %d pair label aliases", n)
	}
	log.Printf("Catalog: Postgres (seed from JSON via cmd/seedcatalog; register via /admin/catalog/*)")

	if err := handlers.EnsureCookedLogSchema(sqlDB); err != nil {
		log.Printf("cooked_log schema ensure failed: %v", err)
	}

	redisClient := redislib.New(cfg)
	defer redisClient.Close()
	cookedLogSvc := services.NewCookedLogService(sqlDB, redisClient)
	mealOfDayCache := services.NewMealOfDayCache(redisClient)
	mealPlanCache := services.NewMealPlanCache(redisClient, cfg.MealPlanCacheTTL)
	dietDigestSvc := services.NewDietDigestService(sqlDB, cookedLogSvc, cfg)
	services.StartNightlyDigestScheduler(dietDigestSvc)
	handlers.StartMealOfDayScheduler(sqlDB, cfg, cookedLogSvc, mealOfDayCache)
	handlers.StartWeekPlanScheduler(sqlDB, cfg, cookedLogSvc, mealPlanCache)

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
	api.Use(middleware.MinAppVersion(cfg))

	// Public routes
	api.HandleFunc("/auth/google-login", authHandler.GoogleLogin).Methods("POST", "OPTIONS")
	api.HandleFunc("/auth/me", authHandler.Me).Methods("GET", "OPTIONS")
	api.HandleFunc("/auth/logout", authHandler.Logout).Methods("POST", "OPTIONS")
	api.HandleFunc("/app/config", handlers.GetAppConfig(cfg)).Methods("GET", "OPTIONS")

	// Inventory (specific paths before {id} wildcard)
	api.Handle("/kitchen", middleware.RequireAuth(http.HandlerFunc(handlers.GetKitchen(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/kitchen/create", middleware.RequireAuth(http.HandlerFunc(handlers.CreateKitchen(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/kitchen/join", middleware.RequireAuth(http.HandlerFunc(handlers.JoinKitchenByInviteCode(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/kitchen/leave", middleware.RequireAuth(http.HandlerFunc(handlers.LeaveKitchen(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/ingredients", middleware.RequireAuth(http.HandlerFunc(handlers.GetIngredientsCatalog()))).Methods("GET", "OPTIONS")
	api.Handle("/dishes", middleware.RequireAuth(http.HandlerFunc(handlers.GetDishesCatalog()))).Methods("GET", "OPTIONS")
	api.Handle("/dishes/lookup", middleware.RequireAuth(http.HandlerFunc(handlers.GetDishLookup(cfg)))).Methods("GET", "OPTIONS")
	api.Handle("/dishes/recipes", middleware.RequireAuth(http.HandlerFunc(handlers.ListDishRecipes(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/dishes/{dish_id}/recipe", middleware.RequireAuth(http.HandlerFunc(handlers.GetDishRecipe(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/inventory/food-groups", middleware.RequireAuth(http.HandlerFunc(handlers.GetInventoryFoodGroups(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/inventory/backfill-food-groups", middleware.RequireAuth(http.HandlerFunc(handlers.BackfillInventoryFoodGroups(sqlDB, cfg)))).Methods("POST", "OPTIONS")
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
	api.Handle("/cook/messages", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookMessages(cookedLogSvc)))).Methods("GET", "OPTIONS")

	// Global dish stars (one star per user per dish)
	api.Handle("/dishes/star", middleware.RequireAuth(http.HandlerFunc(handlers.StarDish(sqlDB)))).Methods("POST", "OPTIONS")

	// Freemium entitlements (plan, bill scan usage, meal category access)
	api.Handle("/entitlements", middleware.RequireAuth(http.HandlerFunc(handlers.GetEntitlements(sqlDB)))).Methods("GET", "OPTIONS")

	billingSvc := services.NewBillingService(sqlDB, cfg.Razorpay)
	billingHandler := handlers.NewBillingHandler(billingSvc, cfg.Razorpay)
	api.Handle("/billing/config", middleware.RequireAuth(http.HandlerFunc(billingHandler.GetBillingConfig()))).Methods("GET", "OPTIONS")
	api.Handle("/billing/plans", middleware.RequireAuth(http.HandlerFunc(billingHandler.ListPlans()))).Methods("GET", "OPTIONS")
	api.Handle("/billing/subscribe/quote", middleware.RequireAuth(http.HandlerFunc(billingHandler.QuoteSubscribe()))).Methods("POST", "OPTIONS")
	api.Handle("/billing/subscribe/order", middleware.RequireAuth(http.HandlerFunc(billingHandler.CreateSubscribeOrder()))).Methods("POST", "OPTIONS")
	api.Handle("/billing/subscribe/verify", middleware.RequireAuth(http.HandlerFunc(billingHandler.VerifySubscribePayment()))).Methods("POST", "OPTIONS")
	api.Handle("/billing/subscribe/sync", middleware.RequireAuth(http.HandlerFunc(billingHandler.SyncSubscribePayment()))).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/v1/billing/razorpay/webhook", billingHandler.RazorpayWebhook()).Methods("POST")

	// Admin (X-Admin-Key / Bearer ADMIN_API_KEY — not user session auth)
	admin := router.PathPrefix("/api/v1/admin").Subrouter()
	admin.Use(middleware.RequireAdmin(cfg.AdminAPIKey))
	admin.HandleFunc("/subscriptions/cancel", handlers.CancelSubscription(sqlDB)).Methods("POST", "OPTIONS")
	admin.HandleFunc("/meal-of-day/refresh", handlers.AdminRefreshMealOfDay(sqlDB, cfg, cookedLogSvc, mealOfDayCache)).Methods("POST", "OPTIONS")
	admin.HandleFunc("/meal-of-day/clear-cache", handlers.AdminClearMealOfDayCache(mealOfDayCache)).Methods("POST", "OPTIONS")
	admin.HandleFunc("/inventory/backfill-food-groups", handlers.AdminBackfillInventoryFoodGroups(sqlDB, cfg)).Methods("POST", "OPTIONS")
	admin.HandleFunc("/inventory/backfill-catalog", handlers.AdminBackfillInventoryCatalog(sqlDB)).Methods("POST", "OPTIONS")
	admin.HandleFunc("/catalog/pair-aliases", handlers.AdminListPairLabelAliases(sqlDB)).Methods("GET", "OPTIONS")
	admin.HandleFunc("/catalog/pair-aliases", handlers.AdminRegisterPairLabelAlias(sqlDB)).Methods("POST", "OPTIONS")
	admin.HandleFunc("/catalog/pair-aliases", handlers.AdminDeletePairLabelAlias(sqlDB)).Methods("DELETE", "OPTIONS")
	admin.HandleFunc("/catalog/dishes", handlers.AdminUpsertCatalogDish(sqlDB)).Methods("POST", "OPTIONS")
	if cfg.AdminAPIKey != "" {
		log.Printf("Admin API enabled at /api/v1/admin/*")
	} else {
		log.Printf("Admin API disabled (set ADMIN_API_KEY to enable)")
	}

	// Ops panel (session auth + email allowlist; 404 for everyone else).
	panelGuard := middleware.RequirePanelAdmin(cfg.AdminPanelEmails)
	panel := api.PathPrefix("/panel").Subrouter()
	panel.Handle("/access", panelGuard(http.HandlerFunc(handlers.PanelAccess()))).Methods("GET", "OPTIONS")
	panel.Handle("/catalog/pair-aliases", panelGuard(handlers.AdminListPairLabelAliases(sqlDB))).Methods("GET", "OPTIONS")
	panel.Handle("/catalog/pair-aliases", panelGuard(handlers.AdminRegisterPairLabelAlias(sqlDB))).Methods("POST", "OPTIONS")
	panel.Handle("/catalog/pair-aliases", panelGuard(handlers.AdminDeletePairLabelAlias(sqlDB))).Methods("DELETE", "OPTIONS")
	panel.Handle("/catalog/dishes", panelGuard(handlers.AdminUpsertCatalogDish(sqlDB))).Methods("POST", "OPTIONS")
	if len(cfg.AdminPanelEmails) > 0 {
		log.Printf("Ops panel API enabled at /api/v1/panel/* (%d allowlisted emails)", len(cfg.AdminPanelEmails))
	} else {
		log.Printf("Ops panel API disabled (set ADMIN_PANEL_EMAILS to enable)")
	}

	// Bill scanning
	api.Handle("/bill/scan", middleware.RequireAuth(http.HandlerFunc(handlers.ScanBill(sqlDB, cfg)))).Methods("POST", "OPTIONS")
	api.Handle("/bill/scan/upload", middleware.RequireAuth(http.HandlerFunc(handlers.ScanBillMultipart(sqlDB, cfg)))).Methods("POST", "OPTIONS")
	api.Handle("/bill/scan/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestScanBill(sqlDB)))).Methods("GET", "OPTIONS")

	// WhatsApp
	api.Handle("/whatsapp/send", middleware.RequireAuth(http.HandlerFunc(handlers.SendWhatsAppMessage(sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/send-meal-suggestion", middleware.RequireAuth(http.HandlerFunc(handlers.SendMealSuggestionToCook(sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/send-daily-menu", middleware.RequireAuth(http.HandlerFunc(handlers.SendDailyMenuToCook(sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestWhatsAppIntegration(sqlDB, cfg)))).Methods("GET", "OPTIONS")
	api.Handle("/whatsapp/cook-info", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookWhatsAppInfo(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/whatsapp/parse", middleware.RequireAuth(http.HandlerFunc(handlers.ParseWhatsAppMessage(cfg)))).Methods("POST", "OPTIONS")
	api.Handle("/whatsapp/apply", middleware.RequireAuth(http.HandlerFunc(handlers.ApplyWhatsAppAction(sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")

	// Smart Meals & cooked history
	api.Handle("/meals/smart", middleware.RequireAuth(http.HandlerFunc(handlers.GetSmartMeals(sqlDB, cfg, cookedLogSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/meal-of-day", middleware.RequireAuth(http.HandlerFunc(handlers.GetMealOfDay(mealOfDayCache, sqlDB, cfg, cookedLogSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/week-plan", middleware.RequireAuth(http.HandlerFunc(handlers.GetWeekPlan(mealPlanCache, sqlDB, cfg, cookedLogSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/week-plan/refresh", middleware.RequireAuth(http.HandlerFunc(handlers.PostRefreshWeekPlan(mealPlanCache, sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/meals/week-plan/set-dish", middleware.RequireAuth(http.HandlerFunc(handlers.PostSetWeekPlanDish(mealPlanCache, sqlDB, cfg, cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/meals/cooked-history", middleware.RequireAuth(http.HandlerFunc(handlers.GetCookedHistory(cookedLogSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/cooked", middleware.RequireAuth(http.HandlerFunc(handlers.LogCookedDish(cookedLogSvc)))).Methods("POST", "OPTIONS")
	api.Handle("/meals/diet-analysis", middleware.RequireAuth(http.HandlerFunc(handlers.GetDietAnalysisSettings(dietDigestSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/diet-analysis", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateDietAnalysisSettings(dietDigestSvc)))).Methods("PUT", "OPTIONS")
	api.Handle("/meals/diet-analysis/report", middleware.RequireAuth(http.HandlerFunc(handlers.GetDietDayReport(dietDigestSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/meals/diet-analysis/send-test", middleware.RequireAuth(http.HandlerFunc(handlers.SendDietDigestTest(dietDigestSvc)))).Methods("POST", "OPTIONS")

	// Legacy rescue meals
	api.Handle("/rescue-meal/suggestions", middleware.RequireAuth(http.HandlerFunc(handlers.GetRescueMealSuggestions(sqlDB)))).Methods("GET", "POST", "OPTIONS")
	api.Handle("/rescue-meal/simple", middleware.RequireAuth(http.HandlerFunc(handlers.GetSimpleRescueMeal(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/rescue-meal/test", middleware.RequireAuth(http.HandlerFunc(handlers.TestRescueMeal(sqlDB)))).Methods("GET", "OPTIONS")

	// Shopping List
	api.Handle("/shopping", middleware.RequireAuth(http.HandlerFunc(handlers.GetShoppingItems(sqlDB)))).Methods("GET", "OPTIONS")
	api.Handle("/shopping", middleware.RequireAuth(http.HandlerFunc(handlers.AddShoppingItem(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/shopping/bulk", middleware.RequireAuth(http.HandlerFunc(handlers.AddBulkShoppingItems(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/shopping/purchase", middleware.RequireAuth(http.HandlerFunc(handlers.PurchaseShoppingItems(sqlDB, kafkaProducer)))).Methods("POST", "OPTIONS")
	api.Handle("/shopping/bulk-delete", middleware.RequireAuth(http.HandlerFunc(handlers.BulkDeleteShoppingItems(sqlDB)))).Methods("POST", "OPTIONS")
	api.Handle("/shopping/order-suggestions", middleware.RequireAuth(http.HandlerFunc(handlers.GetOrderSuggestions(sqlDB, mealPlanCache, cfg, cookedLogSvc)))).Methods("GET", "OPTIONS")
	api.Handle("/shopping/{id}", middleware.RequireAuth(http.HandlerFunc(handlers.UpdateShoppingItem(sqlDB)))).Methods("PUT", "OPTIONS")
	api.Handle("/shopping/{id}", middleware.RequireAuth(http.HandlerFunc(handlers.DeleteShoppingItem(sqlDB)))).Methods("DELETE", "OPTIONS")

	// Commerce (Phase 0): grocery "order this list" deep-links from the household shopping flow.
	api.Handle("/commerce/partners", middleware.RequireAuth(http.HandlerFunc(handlers.GetCommercePartners(cfg)))).Methods("GET", "OPTIONS")
	api.Handle("/commerce/order-link", middleware.RequireAuth(http.HandlerFunc(handlers.CreateOrderLink(sqlDB, cfg)))).Methods("POST", "OPTIONS")

	// Restaurant platform (modular monolith — extractable to restaurant-api later)
	kitchenSvc := kitchenpostgres.New(sqlDB)
	invSvc := invpostgres.New(sqlDB)
	menuSvc := restaurantsvc.NewMenuService(sqlDB, cfg)
	deductionSvc := restaurantsvc.NewDeductionEngine(invSvc)
	orderSvc := restaurantsvc.NewOrderService(sqlDB, menuSvc, deductionSvc)
	billingRestSvc := restaurantsvc.NewBillingService(kitchenSvc)
	analyticsSvc := restaurantsvc.NewAnalyticsService(sqlDB)
	shoppingRestSvc := restaurantsvc.NewShoppingService(sqlDB)
	zomatoSvc := zomatosvc.NewService(sqlDB, orderSvc, menuSvc)
	zomatoSvc.ResumeRunningSyncs(context.Background())
	restHandler := restauranthttp.NewHandler(kitchenSvc, invSvc, menuSvc, orderSvc, shoppingRestSvc, billingRestSvc, analyticsSvc, zomatoSvc, sqlDB)
	publicConnect := router.PathPrefix("/api/v1").Subrouter()
	restHandler.RegisterZomatoPublicConnect(publicConnect)
	restHandler.RegisterZomatoConnectFallback(router)
	restRouter := api.PathPrefix("").Subrouter()
	restRouter.Use(middleware.RequireAuth)
	restHandler.RegisterRoutes(restRouter)
	restHandler.RegisterZomatoIngest(api)

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

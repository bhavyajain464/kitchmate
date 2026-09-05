// CLI to send marketing push notifications via Expo.
//
// Usage:
//
//	go run ./cmd/send-push -title "New feature" -body "Try Cook mode recipes" [-broadcast] [-email user@example.com]
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"

	"kitchenai-backend/internal/db"
	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"
)

func main() {
	title := flag.String("title", "", "notification title (required)")
	body := flag.String("body", "", "notification body (required)")
	screen := flag.String("screen", "", "optional in-app screen: Home, Meals, Cook, Inventory, Shopping")
	campaign := flag.String("campaign", "", "optional campaign key for logs")
	broadcast := flag.Bool("broadcast", false, "send to all users with marketing push enabled")
	email := flag.String("email", "", "target user email (when not broadcasting)")
	flag.Parse()

	if *title == "" || *body == "" {
		log.Fatal("title and body are required")
	}
	if !*broadcast && *email == "" {
		log.Fatal("set -broadcast or -email")
	}

	_ = godotenv.Load()
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if !cfg.ExpoPushConfigured() {
		log.Fatal("EXPO_ACCESS_TOKEN is not configured")
	}

	database, err := db.InitDB(
		cfg.DatabaseURL,
		cfg.DatabaseMaxOpenConns,
		cfg.DatabaseMaxIdleConns,
		time.Duration(cfg.DatabaseConnMaxLifetimeMin)*time.Minute,
		time.Duration(cfg.DatabaseConnMaxIdleSec)*time.Second,
	)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer database.Close()

	svc := services.NewPushNotificationService(database.GetDB(), cfg)
	data := map[string]string{"type": "marketing"}
	if s := *screen; s != "" {
		data["screen"] = s
	}
	msg := services.PushMessage{Title: *title, Body: *body, Data: data}
	ctx := context.Background()

	var result *services.PushSendResult
	if *broadcast {
		result, err = svc.SendMarketingBroadcast(ctx, msg, *campaign, "cli@send-push")
	} else {
		userID, resolveErr := svc.ResolveUserIDByEmail(ctx, *email)
		if resolveErr != nil {
			log.Fatalf("resolve user: %v", resolveErr)
		}
		result, err = svc.SendToUser(ctx, userID, msg, *campaign, "cli@send-push")
	}
	if err != nil {
		log.Fatalf("send: %v", err)
	}

	log.Printf("push sent log_id=%s targeted=%d ok=%d error=%d invalid_removed=%d",
		result.LogID, result.TokensTargeted, result.TicketsOK, result.TicketsError, result.InvalidRemoved)
	os.Exit(0)
}

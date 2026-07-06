// One-off CLI to send a sample weekly diet digest for a user.
// Usage: go run ./cmd/send-diet-sample [-email user@example.com]
package main

import (
	"context"
	"database/sql"
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
	email := flag.String("email", "", "recipient user email (defaults to user with most recent meal log)")
	flag.Parse()

	if err := godotenv.Load(); err != nil {
		log.Printf("no .env loaded: %v", err)
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if !cfg.SMTPConfigured() {
		log.Fatal("SMTP is not configured (set SMTP_HOST and SMTP_FROM in backend/.env)")
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

	sqlDB := database.GetDB()
	ctx := context.Background()

	userID, userEmail, err := resolveUser(sqlDB, *email)
	if err != nil {
		log.Fatalf("resolve user: %v", err)
	}

	ent, err := services.GetEntitlements(sqlDB, userID)
	if err != nil {
		log.Fatalf("entitlements: %v", err)
	}
	if !ent.HasDietAnalysis {
		log.Fatalf("user %s does not have Elite diet analysis enabled", userEmail)
	}

	if _, err := sqlDB.ExecContext(ctx, `
		UPDATE users
		SET diet_analysis_email_enabled = TRUE,
		    diet_analysis_last_sent_date = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1
	`, userID); err != nil {
		log.Fatalf("prepare user: %v", err)
	}

	cookedLog := services.NewCookedLogService(sqlDB, nil)
	digest := services.NewDietDigestService(sqlDB, cookedLog, cfg)

	loc, _ := time.LoadLocation("Asia/Kolkata")
	if loc == nil {
		loc = time.UTC
	}
	dateISO := time.Now().In(loc).AddDate(0, 0, -1).Format("2006-01-02")

	if err := digest.SendDigestForUser(ctx, userID, dateISO); err != nil {
		log.Fatalf("send failed: %v", err)
	}

	log.Printf("sample weekly diet email sent to %s (user_id=%s, week containing %s)", userEmail, userID, dateISO)
	os.Exit(0)
}

func resolveUser(sqlDB *sql.DB, email string) (userID, userEmail string, err error) {
	if email != "" {
		err = sqlDB.QueryRow(`
			SELECT user_id::text, COALESCE(email, '')
			FROM users WHERE LOWER(email) = LOWER($1)
		`, email).Scan(&userID, &userEmail)
		return userID, userEmail, err
	}
	err = sqlDB.QueryRow(`
		SELECT u.user_id::text, COALESCE(u.email, '')
		FROM cooked_log c
		JOIN users u ON u.user_id = c.user_id
		ORDER BY c.created_at DESC
		LIMIT 1
	`).Scan(&userID, &userEmail)
	return userID, userEmail, err
}

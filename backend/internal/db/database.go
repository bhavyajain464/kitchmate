package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

// Database holds the connection pool
type Database struct {
	db *sql.DB
}

// InitDB initializes a new database connection with an explicit pool size so a small API
// does not open dozens of connections to a shared Postgres.
func InitDB(dataSourceName string, maxOpen, maxIdle int, connMaxLifetime, connMaxIdleTime time.Duration) (*Database, error) {
	sqlDB, err := sql.Open("postgres", dataSourceName)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test the connection
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(connMaxLifetime)
	if connMaxIdleTime > 0 {
		sqlDB.SetConnMaxIdleTime(connMaxIdleTime)
	}

	log.Printf("Database pool: maxOpen=%d maxIdle=%d maxLifetime=%v maxIdleTime=%v",
		maxOpen, maxIdle, connMaxLifetime, connMaxIdleTime)
	return &Database{db: sqlDB}, nil
}

// Close closes the database connection
func (d *Database) Close() error {
	return d.db.Close()
}

// GetDB returns the underlying *sql.DB for direct use
func (d *Database) GetDB() *sql.DB {
	return d.db
}

// CreateTables creates the necessary tables if they don't exist
func (d *Database) CreateTables() error {
	// Read schema from file or embed it
	// For now, we'll assume tables are already created via schema.sql
	return nil
}

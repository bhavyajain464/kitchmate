package db

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

// Database holds the connection pool
type Database struct {
	db *sql.DB
}

// InitDB initializes a new database connection
func InitDB(dataSourceName string) (*Database, error) {
	sqlDB, err := sql.Open("postgres", dataSourceName)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test the connection
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("Database connection established successfully")
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

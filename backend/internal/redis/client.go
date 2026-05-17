package redis

import (
	"context"
	"log"
	"strings"
	"time"

	"kitchenai-backend/pkg/config"

	goredis "github.com/redis/go-redis/v9"
)

// Client wraps go-redis; nil when Redis is not configured.
type Client struct {
	rdb *goredis.Client
}

func New(cfg *config.Config) *Client {
	url := strings.TrimSpace(cfg.RedisURL)
	if url == "" {
		log.Println("Redis: disabled (REDIS_URL empty); cooked history uses Postgres only")
		return &Client{}
	}
	opt, err := goredis.ParseURL(url)
	if err != nil {
		log.Printf("Redis: invalid REDIS_URL (%v); cooked history uses Postgres only", err)
		return &Client{}
	}
	rdb := goredis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("Redis: ping failed (%v); cooked history uses Postgres only", err)
		return &Client{}
	}
	log.Println("Redis: connected")
	return &Client{rdb: rdb}
}

func (c *Client) Enabled() bool {
	return c != nil && c.rdb != nil
}

func (c *Client) Raw() *goredis.Client {
	if c == nil {
		return nil
	}
	return c.rdb
}

func (c *Client) Close() error {
	if c == nil || c.rdb == nil {
		return nil
	}
	return c.rdb.Close()
}

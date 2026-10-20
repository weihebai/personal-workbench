package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Addr       string
	DBPath     string
	JWTSecret  string
	TokenTTL   time.Duration
	AdminUser  string
	AdminPass  string
	CORSOrigin string
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() *Config {
	ttlHours, _ := strconv.Atoi(env("TOKEN_TTL_HOURS", "168"))
	if ttlHours <= 0 {
		ttlHours = 168
	}
	return &Config{
		Addr:       env("ADDR", ":8080"),
		DBPath:     env("DB_PATH", "./data/workbench.db"),
		JWTSecret:  env("JWT_SECRET", ""),
		TokenTTL:   time.Duration(ttlHours) * time.Hour,
		AdminUser:  env("ADMIN_USER", "admin"),
		AdminPass:  env("ADMIN_PASS", "admin123"),
		CORSOrigin: env("CORS_ORIGIN", "*"),
	}
}

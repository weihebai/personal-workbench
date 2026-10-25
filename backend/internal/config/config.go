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
	// 上传目录。默认放在 data/ 下，跟着数据库一起备份、一起挂卷，
	// 不需要额外的对象存储。
	UploadDir string
	// 单张图片大小上限（字节），默认 10MB
	MaxUploadBytes int64
	// 备份包导入大小上限（字节），默认 2GB。导出不受限（流式写出）。
	MaxBackupUploadBytes int64
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
	maxMB, _ := strconv.Atoi(env("MAX_UPLOAD_MB", "10"))
	if maxMB <= 0 {
		maxMB = 10
	}
	backupMB, _ := strconv.Atoi(env("MAX_BACKUP_UPLOAD_MB", "2048"))
	if backupMB <= 0 {
		backupMB = 2048
	}
	return &Config{
		Addr:       env("ADDR", ":8080"),
		DBPath:     env("DB_PATH", "./data/workbench.db"),
		JWTSecret:  env("JWT_SECRET", ""),
		TokenTTL:   time.Duration(ttlHours) * time.Hour,
		AdminUser:  env("ADMIN_USER", "admin"),
		AdminPass:  env("ADMIN_PASS", "admin123"),
		CORSOrigin: env("CORS_ORIGIN", "*"),
		// 默认 ./data/uploads：数据库在 ./data/workbench.db，
		// 图片放同一个父目录，备份时一个 data/ 目录全带走。
		UploadDir:      env("UPLOAD_DIR", "./data/uploads"),
		MaxUploadBytes: int64(maxMB) * 1024 * 1024,
		MaxBackupUploadBytes: int64(backupMB) * 1024 * 1024,
	}
}

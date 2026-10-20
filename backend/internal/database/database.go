package database

import (
	"fmt"
	"os"
	"path/filepath"

	"personal-workbench/internal/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Open(path string) (*gorm.DB, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}
	db, err := gorm.Open(sqlite.Open(path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, err
	}
	if err := db.AutoMigrate(model.AllModels()...); err != nil {
		return nil, fmt.Errorf("automigrate: %w", err)
	}
	return db, nil
}

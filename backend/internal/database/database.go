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

// Close 关闭数据库前把 WAL 内容合并回主库文件。
// 不这么做的话，正常退出后数据仍留在 -wal 文件里，
// 此时直接 cp workbench.db 会丢失全部数据。
func Close(db *gorm.DB) error {
	if db == nil {
		return nil
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	// TRUNCATE 会 checkpoint 并清空 WAL 文件
	if _, err := sqlDB.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		// checkpoint 失败不阻止关闭，但要记下来
		_ = sqlDB.Close()
		return fmt.Errorf("wal checkpoint: %w", err)
	}
	return sqlDB.Close()
}

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
	if err := dropLegacyAttachmentHashUnique(db); err != nil {
		return nil, fmt.Errorf("drop legacy unique index: %w", err)
	}
	return db, nil
}

// 早期版本在 attachments.hash 上建了唯一索引，导致同一张图无法挂到两个任务：
// 第二条记录插不进去，代码只能去改第一条，表现就是「B 任务上传同一张图，
// A 任务的图凭空消失」。
//
// 现在改成普通索引，但 AutoMigrate 只加不删，老库里那个唯一索引还在，
// 所以这里显式把它删掉。SQLite 里 uniqueIndex 是自动命名的索引
// （idx_attachments_hash），先查出来确认它确实是 UNIQUE 再删，
// 避免误删用户手工建的索引。
func dropLegacyAttachmentHashUnique(db *gorm.DB) error {
	type idxRow struct {
		Name   string
		Unique int
	}
	var rows []idxRow
	if err := db.Raw("PRAGMA index_list('attachments')").Scan(&rows).Error; err != nil {
		// 表还不存在（全新库）时不算错误
		return nil
	}
	for _, r := range rows {
		if r.Unique != 1 {
			continue
		}
		// 确认这个唯一索引是否正好建在 hash 上
		type colRow struct {
			Name string
		}
		var cols []colRow
		if err := db.Raw("PRAGMA index_info('" + r.Name + "')").Scan(&cols).Error; err != nil {
			continue
		}
		if len(cols) == 1 && cols[0].Name == "hash" {
			if err := db.Exec("DROP INDEX IF EXISTS '" + r.Name + "'").Error; err != nil {
				return err
			}
			if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(hash)").Error; err != nil {
				return err
			}
		}
	}
	return nil
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

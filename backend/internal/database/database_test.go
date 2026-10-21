package database

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 老库升级路径：早期 attachments.hash 上有唯一索引，同一张图挂不到两个任务。
// 这个测试模拟「老库」建表方式，再跑迁移，确认唯一索引被换成普通索引。
//
// 为什么必须测：AutoMigrate 只加索引不删索引，光改 struct tag 对已有库无效。
// 这个坑只有跑过老库才会暴露——新库测试永远是通过的。
func TestDropLegacyUniqueIndex(t *testing.T) {
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "old.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("打开库失败: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})

	// 用老 schema 建表：hash 上是唯一索引
	if err := db.Exec(`CREATE TABLE attachments (
		id integer PRIMARY KEY AUTOINCREMENT,
		created_at datetime, updated_at datetime,
		hash text NOT NULL,
		name text, mime text, size integer,
		width integer, height integer,
		task_id integer, project_id integer
	)`).Error; err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_attachments_hash ON attachments(hash)`).Error; err != nil {
		t.Fatalf("建唯一索引失败: %v", err)
	}

	// 确认唯一约束此刻真的生效
	if err := db.Exec(`INSERT INTO attachments (hash, name) VALUES ('dup','1')`).Error; err != nil {
		t.Fatalf("第一次插入应成功: %v", err)
	}
	if err := db.Exec(`INSERT INTO attachments (hash, name) VALUES ('dup','2')`).Error; err == nil {
		t.Fatal("老 schema 下第二次插入同 hash 本应失败，说明测试前提不成立")
	}

	// 跑迁移
	if err := dropLegacyAttachmentHashUnique(db); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	// 迁移后同 hash 应该能插入多条
	if err := db.Exec(`INSERT INTO attachments (hash, name) VALUES ('dup','3')`).Error; err != nil {
		t.Fatalf("迁移后同 hash 应能插入多条，实际失败: %v", err)
	}

	// 索引还在（普通索引），否则查询会退化成全表扫描
	var n int
	db.Raw(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_attachments_hash'`).Scan(&n)
	if n != 1 {
		t.Fatal("普通索引应该保留")
	}
}

// 全新库跑迁移不应报错
func TestDropLegacyOnEmptyDB(t *testing.T) {
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "new.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("打开库失败: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	if err := dropLegacyAttachmentHashUnique(db); err != nil {
		t.Fatalf("空库上迁移不该报错: %v", err)
	}
}

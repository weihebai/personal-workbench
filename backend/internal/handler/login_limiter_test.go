package handler

import (
	"path/filepath"
	"testing"
	"time"

	"personal-workbench/internal/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newLimiterTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "limiter.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(&model.LoginAttempt{}); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}
	return db
}

// 锁定状态必须落库：换一个 limiter 实例（等价于进程重启）仍然生效。
func TestLoginLimiterPersistsAcrossRestart(t *testing.T) {
	db := newLimiterTestDB(t)
	key := "203.0.113.1"
	l := newLoginLimiter(db, 2, time.Minute)

	if ok, _ := l.Allow(key); !ok {
		t.Fatal("首次尝试应允许")
	}
	if remaining, locked := l.Fail(key); remaining != 1 || locked != 0 {
		t.Fatalf("失败一次应剩 1 次且未锁定，得到 remaining=%d locked=%v", remaining, locked)
	}
	if ok, _ := l.Allow(key); !ok {
		t.Fatal("失败一次还不该锁定")
	}
	if remaining, locked := l.Fail(key); remaining != 0 || locked != time.Minute {
		t.Fatalf("达到阈值应返回锁定，得到 remaining=%d locked=%v", remaining, locked)
	}
	if ok, wait := l.Allow(key); ok || wait <= 0 {
		t.Fatalf("连续失败 2 次应锁定，ok=%v wait=%v", ok, wait)
	}

	restarted := newLoginLimiter(db, 2, time.Minute)
	if ok, _ := restarted.Allow(key); ok {
		t.Fatal("重启后锁定状态应保留")
	}

	restarted.Reset(key)
	if ok, _ := restarted.Allow(key); !ok {
		t.Fatal("Reset 后应恢复允许")
	}
}

func TestLoginLimiterUnlocksAfterExpiry(t *testing.T) {
	db := newLimiterTestDB(t)
	key := "203.0.113.2"
	l := newLoginLimiter(db, 1, time.Minute)
	if remaining, locked := l.Fail(key); remaining != 0 || locked != time.Minute {
		t.Fatalf("唯一一次失败应触发锁定，得到 remaining=%d locked=%v", remaining, locked)
	}

	if ok, _ := l.Allow(key); ok {
		t.Fatal("达到阈值后应锁定")
	}

	// 把锁定截止时间改到过去，模拟锁定到期
	past := time.Now().Add(-time.Second)
	if err := db.Model(&model.LoginAttempt{}).
		Where(`"key" = ?`, key).
		Update("locked_until", past).Error; err != nil {
		t.Fatalf("修改锁定时间失败: %v", err)
	}
	if ok, _ := l.Allow(key); !ok {
		t.Fatal("锁定到期后应允许尝试")
	}
	var n int64
	db.Model(&model.LoginAttempt{}).Count(&n)
	if n != 0 {
		t.Fatalf("过期记录应被清理，还剩 %d 条", n)
	}
}

package handler

import (
	"sync"
	"time"

	"personal-workbench/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// loginLimiter 登录失败限流。状态存在 SQLite 里，
// 重启不会清零，多进程也共享同一份计数。
type loginLimiter struct {
	db       *gorm.DB
	mu       sync.Mutex
	maxFails int
	lockFor  time.Duration
}

func newLoginLimiter(db *gorm.DB, maxFails int, lockFor time.Duration) *loginLimiter {
	return &loginLimiter{db: db, maxFails: maxFails, lockFor: lockFor}
}

// Allow 是否允许尝试；被锁定时返回剩余时长。
func (l *loginLimiter) Allow(key string) (bool, time.Duration) {
	var a model.LoginAttempt
	if err := l.db.Where(`"key" = ?`, key).First(&a).Error; err != nil {
		return true, 0
	}
	now := time.Now()
	if a.LockedUntil != nil && now.Before(*a.LockedUntil) {
		return false, a.LockedUntil.Sub(now)
	}
	if a.LockedUntil != nil {
		l.db.Where(`"key" = ?`, key).Delete(&model.LoginAttempt{})
	}
	return true, 0
}

// Fail 记录一次失败，返回剩余可尝试次数；本次触发锁定时 lockedFor > 0。
func (l *loginLimiter) Fail(key string) (remaining int, lockedFor time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	// 先确保行存在，再用数据库自增，避免并发时读改写丢计数。
	if err := l.db.Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model.LoginAttempt{Key: key, UpdatedAt: now}).Error; err != nil {
		return 0, 0
	}
	if err := l.db.Model(&model.LoginAttempt{}).
		Where(`"key" = ?`, key).
		UpdateColumns(map[string]any{
			"failures":   gorm.Expr("failures + 1"),
			"updated_at": now,
		}).Error; err != nil {
		return 0, 0
	}

	var failures int
	if err := l.db.Model(&model.LoginAttempt{}).
		Where(`"key" = ?`, key).
		Pluck("failures", &failures).Error; err != nil {
		return 0, 0
	}
	if failures >= l.maxFails {
		l.db.Model(&model.LoginAttempt{}).
			Where(`"key" = ?`, key).
			Updates(map[string]any{
				"failures":     0,
				"locked_until": now.Add(l.lockFor),
				"updated_at":   now,
			})
		return 0, l.lockFor
	}
	return l.maxFails - failures, 0
}

func (l *loginLimiter) Reset(key string) {
	l.db.Where(`"key" = ?`, key).Delete(&model.LoginAttempt{})
}

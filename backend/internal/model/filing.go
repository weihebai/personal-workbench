package model

import "time"

type FilingMonitor struct {
	Base
	Name              string     `gorm:"size:128;not null" json:"name"`
	Provider          string     `gorm:"size:16;not null;default:wechat" json:"provider"`
	BaOrderID         string     `gorm:"size:32;not null;default:''" json:"baOrderId"`
	NodeID            string     `gorm:"size:64;not null;default:''" json:"nodeId"`
	Title             string     `gorm:"size:128;not null;default:''" json:"title"`
	ProgressInfo      string     `gorm:"type:text;not null;default:''" json:"progressInfo"`
	ProjectID         *uint      `gorm:"index" json:"projectId"`
	Enabled           bool       `json:"enabled"`
	SessionState      string     `gorm:"size:24" json:"sessionState"`
	AccountID         string     `gorm:"size:128" json:"accountId"`
	Credentials       string     `gorm:"type:text" json:"-"`
	Status            *int       `json:"status"`
	StatusText        string     `gorm:"size:64" json:"statusText"`
	LastCheckedAt     *time.Time `json:"lastCheckedAt"`
	LastSuccessAt     *time.Time `json:"lastSuccessAt"`
	LastError         string     `gorm:"type:text" json:"lastError"`
	PendingNotice     string     `gorm:"type:text" json:"-"`
	NotificationError string     `gorm:"type:text" json:"notificationError"`
}

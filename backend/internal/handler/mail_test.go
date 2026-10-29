package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

func TestDueReminders(t *testing.T) {
	now := time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)
	today := now.Format("2006-01-02")
	mk := func(title string, expire time.Time, remindDays int, notifiedOn string) model.Reminder {
		return model.Reminder{Title: title, ExpireAt: expire, RemindDays: remindDays, Enabled: true, NotifiedOn: notifiedOn}
	}
	items := []model.Reminder{
		mk("即将到期", now.AddDate(0, 0, 3), 7, ""),
		mk("还很远", now.AddDate(0, 0, 30), 7, ""),
		mk("已经过期", now.AddDate(0, 0, -2), 7, ""),
		mk("今天发过", now.AddDate(0, 0, 3), 7, today),
		mk("刚好在提醒期外", now.AddDate(0, 0, 8), 7, ""),
	}

	got := dueReminders(items, now)
	if len(got) != 2 {
		t.Fatalf("应选出 2 条，实际 %d 条: %+v", len(got), got)
	}
	if got[0].Title != "即将到期" || got[1].Title != "已经过期" {
		t.Fatalf("选出的提醒不对: %s / %s", got[0].Title, got[1].Title)
	}
}

func TestReminderMail(t *testing.T) {
	now := time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)
	items := []model.Reminder{
		{Title: "域名续费", Category: "domain", ExpireAt: now.AddDate(0, 0, -2), Target: "example.com"},
		{Title: "服务器续费", Category: "server", ExpireAt: now.AddDate(0, 0, 3), Note: "第一行\n第二行"},
	}

	subject, body := reminderMail(items, now)

	if !strings.Contains(subject, "2 项") || !strings.Contains(subject, "已过期 1 项") {
		t.Fatalf("主题不正确: %s", subject)
	}
	for _, want := range []string{
		"域名续费", "已过期 2 天", "对象：example.com",
		"服务器续费", "剩余 3 天", "备注：第一行 第二行",
		"2026-10-29",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("正文缺少 %q:\n%s", want, body)
		}
	}
}

func TestSmtpViewHidesPassword(t *testing.T) {
	h, _ := newTestHandler(t)
	encrypted, err := h.encryptSecret("SMTP-PASSWORD-123")
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range map[string]string{
		smtpHostKey:     "smtp.example.com",
		smtpPortKey:     "465",
		smtpUsernameKey: "me@example.com",
		smtpPasswordKey: encrypted,
		smtpFromKey:     "me@example.com",
		smtpToKey:       "me@example.com",
		smtpSSLKey:      "1",
		smtpEnabledKey:  "1",
	} {
		if err := h.saveSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/settings/smtp", nil)
	h.GetSmtpSetting(c)

	if w.Code != http.StatusOK {
		t.Fatalf("状态码 %d", w.Code)
	}
	if strings.Contains(w.Body.String(), "SMTP-PASSWORD-123") || strings.Contains(w.Body.String(), encrypted) {
		t.Fatalf("响应不应包含 SMTP 密码: %s", w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["configured"] != true || out["passwordSaved"] != true || out["port"] != float64(465) || out["enabled"] != true {
		t.Fatalf("配置状态不正确: %s", w.Body.String())
	}
}

func TestClearSmtpSetting(t *testing.T) {
	h, _ := newTestHandler(t)
	for _, k := range smtpSettingKeys {
		if err := h.saveSetting(k, "x"); err != nil {
			t.Fatal(err)
		}
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/settings/smtp", nil)
	h.ClearSmtpSetting(c)

	for _, k := range smtpSettingKeys {
		if v := h.settingValue(k); v != "" {
			t.Fatalf("%s 应被清除，实际 %q", k, v)
		}
	}
}

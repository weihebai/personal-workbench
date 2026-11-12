package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"personal-workbench/internal/model"
)

func TestReminderArchiveAndRestorePreserveRecord(t *testing.T) {
	h, _ := newTestHandler(t)
	r := model.Reminder{Title: "服务器", Category: "server", Target: "example.com", ExpireAt: time.Now().Add(-48 * time.Hour), Enabled: true, Note: "保留备注"}
	if err := h.DB.Create(&r).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.PATCH("/reminders/:id/archive", h.ArchiveReminder)
	router.GET("/reminders", h.ListReminders)
	request := func(method, path, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)
		return w
	}
	for _, body := range []string{`{}`, `{"archived":null}`, `{"archived":"yes"}`} {
		if w := request("PATCH", "/reminders/1/archive", body); w.Code != 400 {
			t.Fatalf("invalid archive input: %d", w.Code)
		}
	}
	if w := request("PATCH", "/reminders/999/archive", `{"archived":true}`); w.Code != 404 {
		t.Fatalf("missing record: %d", w.Code)
	}
	for _, archived := range []bool{true, true, false} {
		body := `{"archived":false}`
		if archived {
			body = `{"archived":true}`
		}
		if w := request("PATCH", "/reminders/1/archive", body); w.Code != 200 {
			t.Fatalf("archive: %d %s", w.Code, w.Body.String())
		}
		var stored model.Reminder
		if err := h.DB.First(&stored, r.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.Archived != archived || !stored.Enabled || stored.Title != r.Title || stored.Target != r.Target || stored.Note != r.Note || !stored.ExpireAt.Equal(r.ExpireAt) {
			t.Fatal("archive changed reminder data")
		}
		for _, query := range []string{"", "?archived=1"} {
			w := request("GET", "/reminders"+query, "")
			var response struct {
				Items []model.Reminder `json:"items"`
			}
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
				t.Fatal("list failed")
			}
			want := 0
			if (query == "?archived=1") == archived {
				want = 1
			}
			if len(response.Items) != want {
				t.Fatalf("wrong archive list %s: %s", query, w.Body.String())
			}
		}
	}
	if w := request("GET", "/reminders?archived=invalid", ""); w.Code != 400 {
		t.Fatal("invalid archive filter accepted")
	}
}

func TestArchivedRemindersDoNotAppearInDashboardOrMail(t *testing.T) {
	h, _ := newTestHandler(t)
	now := time.Now()
	items := []model.Reminder{
		{Title: "有效提醒", ExpireAt: now.Add(-24 * time.Hour), Enabled: true},
		{Title: "归档提醒", ExpireAt: now.Add(-24 * time.Hour), Enabled: true, Archived: true},
	}
	if err := h.DB.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	if due := dueReminders(items, now); len(due) != 1 || due[0].Title != "有效提醒" {
		t.Fatal("archived reminder selected for email")
	}
	router := gin.New()
	router.GET("/dashboard", h.Dashboard)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/dashboard", nil))
	var response struct {
		Counts struct {
			RemindersExpired int `json:"remindersExpired"`
		} `json:"counts"`
		SoonReminders []model.Reminder `json:"soonReminders"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatalf("dashboard: %s", w.Body.String())
	}
	if response.Counts.RemindersExpired != 1 || len(response.SoonReminders) != 1 || response.SoonReminders[0].Title != "有效提醒" {
		t.Fatal("dashboard included archived reminders")
	}
}

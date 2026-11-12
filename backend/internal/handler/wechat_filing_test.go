package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"personal-workbench/internal/model"
	"personal-workbench/internal/wechat"
)

func TestConcurrentFilingCredentialsUseSameLocalKey(t *testing.T) {
	h, _ := newTestHandler(t)
	start := make(chan struct{})
	keys := make(chan []byte, 24)
	errors := make(chan error, 24)
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			key, err := h.localSecretKey()
			if err != nil {
				errors <- err
				return
			}
			keys <- key
		}()
	}
	close(start)
	wg.Wait()
	close(keys)
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	stored, err := h.localSecretKey()
	if err != nil {
		t.Fatal(err)
	}
	for key := range keys {
		if !bytes.Equal(key, stored) {
			t.Fatal("concurrent logins generated different local encryption keys")
		}
	}
}

func TestFilingBusyMonitorDoesNotBlockOtherMonitors(t *testing.T) {
	h, _ := newTestHandler(t)
	for _, name := range []string{"busy", "other"} {
		if err := h.DB.Create(&model.FilingMonitor{Name: name}).Error; err != nil {
			t.Fatal(err)
		}
	}
	r := gin.New()
	r.PUT("/wechat-filing/:id", h.UpdateFilingMonitor)
	lock := h.filingLock(1)
	lock.Lock()
	done := make(chan int, 1)
	go func() {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/wechat-filing/2", strings.NewReader(`{"enabled":true}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		done <- w.Code
	}()
	select {
	case status := <-done:
		lock.Unlock()
		if status != 200 {
			t.Fatalf("update: %d", status)
		}
	case <-time.After(time.Second):
		lock.Unlock()
		<-done
		t.Fatal("another monitor blocked this request")
	}
}

func TestFilingTableDoesNotPreventRestoringOlderBackups(t *testing.T) {
	source, _ := newTestHandler(t)
	if err := source.DB.Migrator().DropTable(&model.FilingMonitor{}); err != nil {
		t.Fatal(err)
	}
	target, _ := newTestHandler(t)
	tables, err := target.tableNames()
	if err != nil {
		t.Fatal(err)
	}
	backupPath := filepath.Join(t.TempDir(), "old.db")
	if err := source.DB.Exec("VACUUM INTO ?", backupPath).Error; err != nil {
		t.Fatal(err)
	}
	if err := verifyBackupDB(backupPath, tables); err != nil {
		t.Fatalf("old backup rejected: %v", err)
	}
	if err := target.DB.Create(&model.FilingMonitor{Name: "existing"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := target.restoreDatabase(backupPath, tables); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := target.DB.Model(&model.FilingMonitor{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("monitor table should be empty: %d %v", count, err)
	}
}

func TestFilingLoginMissingAndExpiredScansRequireNewQRCode(t *testing.T) {
	h, _ := newTestHandler(t)
	m := model.FilingMonitor{Name: "扫码", SessionState: "disconnected"}
	if err := h.DB.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.GET("/wechat-filing/:id/login", h.PollFilingLogin)
	for _, withExpired := range []bool{false, true} {
		if withExpired {
			h.filingScans = map[uint]*filingScan{m.ID: {expires: time.Now().Add(-time.Second), state: "waiting"}}
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/wechat-filing/1/login", nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"state":"expired"`) {
			t.Fatalf("expired scan: %d %s", w.Code, w.Body.String())
		}
		if len(h.filingScans) != 0 {
			t.Fatal("expired session retained")
		}
	}
}

func TestFilingCredentialsFailureRequiresRescan(t *testing.T) {
	h, _ := newTestHandler(t)
	m := model.FilingMonitor{Name: "扫码", SessionState: "connected", Credentials: "invalid-cipher", Enabled: true}
	if err := h.DB.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	if err := h.checkFiling(t.Context(), &m); err != nil {
		t.Fatal(err)
	}
	if m.SessionState != "expired" || m.Credentials != "" || !strings.Contains(m.PendingNotice, "重新扫码") {
		t.Fatal("invalid credentials did not request login")
	}
}

func TestCreateFilingMonitorValidatesProjectAndHidesCredentials(t *testing.T) {
	h, _ := newTestHandler(t)
	r := gin.New()
	r.POST("/wechat-filing", h.CreateFilingMonitor)
	r.GET("/wechat-filing", h.ListFilingMonitors)
	request := func(method, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/wechat-filing", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w
	}
	if w := request(http.MethodPost, `{"name":"备案","projectId":999}`); w.Code != 400 {
		t.Fatalf("invalid project accepted: %d %s", w.Code, w.Body.String())
	}
	if w := request(http.MethodPost, `{"name":" "}`); w.Code != 400 {
		t.Fatalf("empty name accepted: %d", w.Code)
	}
	w := request(http.MethodPost, `{"name":"仪器小程序"}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var monitor model.FilingMonitor
	if err := json.Unmarshal(w.Body.Bytes(), &monitor); err != nil {
		t.Fatal(err)
	}
	secret, err := h.encryptSecret(`{"token":"private-token","cookies":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.DB.Model(&monitor).Update("credentials", secret).Error; err != nil {
		t.Fatal(err)
	}
	w = request(http.MethodGet, "")
	for _, secret := range []string{"private-token", secret, "credentials", "cookies"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatalf("credentials leaked: %s", w.Body.String())
		}
	}
}

func TestFilingResultKeepsLastStatusOnFailureAndNotifiesOnlyChanges(t *testing.T) {
	h, _ := newTestHandler(t)
	m := model.FilingMonitor{Name: "备案", Enabled: true, SessionState: "connected"}
	if err := h.DB.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	if err := h.applyFilingResult(&m, wechat.FilingInfo{Status: 4, StatusText: "管局审核中"}, nil); err != nil {
		t.Fatal(err)
	}
	if m.PendingNotice != "" {
		t.Fatal("first check should not notify")
	}
	if err := h.applyFilingResult(&m, wechat.FilingInfo{}, errors.New("网络失败")); err != nil {
		t.Fatal(err)
	}
	if m.Status == nil || *m.Status != 4 || m.SessionState != "connected" || m.LastError != "网络失败" {
		t.Fatalf("network failure discarded status: %+v", m)
	}
	if err := h.applyFilingResult(&m, wechat.FilingInfo{Status: 6, StatusText: "已完成"}, nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.PendingNotice, "管局审核中") || !strings.Contains(m.PendingNotice, "已完成") {
		t.Fatal("missing transition notification")
	}
	if err := h.applyFilingResult(&m, wechat.FilingInfo{}, wechat.ErrExpired); err != nil {
		t.Fatal(err)
	}
	if m.SessionState != "expired" || *m.Status != 6 || !strings.Contains(m.PendingNotice, "重新扫码") {
		t.Fatalf("expired result: %+v", m)
	}
}

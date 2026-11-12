package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"personal-workbench/internal/aliyun"
	"personal-workbench/internal/model"
)

type aliyunTestTransport func(*http.Request) (*http.Response, error)

func (f aliyunTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAliyunMonitorCreationValidatesPlatformAndOrder(t *testing.T) {
	h, _ := newTestHandler(t)
	r := gin.New()
	r.POST("/monitors", h.CreateFilingMonitor)
	for _, tc := range []struct {
		body string
		code int
	}{
		{`{"name":"微信"}`, 201},
		{`{"name":"域名","provider":"aliyun","baOrderId":"123456"}`, 201},
		{`{"name":"域名","provider":"unknown"}`, 400},
		{`{"name":"域名","provider":"aliyun"}`, 400},
		{`{"name":"域名","provider":"aliyun","baOrderId":"123&x=1"}`, 400},
		{`{"name":"微信","provider":"wechat","baOrderId":"123456"}`, 400},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/monitors", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != tc.code {
			t.Fatalf("creation %s: %d %s", tc.body, w.Code, w.Body.String())
		}
	}
	var monitors []model.FilingMonitor
	h.DB.Order("id").Find(&monitors)
	if len(monitors) != 2 || monitors[0].Provider != "wechat" || monitors[1].Provider != "aliyun" || monitors[1].BaOrderID != "123456" {
		t.Fatalf("wrong providers: %+v", monitors)
	}
}

func TestAliyunSessionImportEncryptsAndBackgroundCheckUpdatesProgress(t *testing.T) {
	h, _ := newTestHandler(t)
	m := model.FilingMonitor{Name: "域名备案", Provider: "aliyun", BaOrderID: "123456", Enabled: true, SessionState: "disconnected"}
	h.DB.Create(&m)
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	response := `{"code":200,"resultCode":"Success","data":{"baOrderId":"123456","progress":[{"nodeId":"FIRST_AUDIT","title":"阿里云初审","status":20,"statusText":"审核中","isCurrentNode":true,"progressInfo":"等待审核"}]}}`
	calls := 0
	http.DefaultTransport = aliyunTestTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Host != "beian.aliyun.com" || req.URL.Query().Get("baOrderId") != "123456" {
			t.Fatal("wrong upstream")
		}
		cookie, err := req.Cookie("login_aliyunid_ticket")
		if err != nil || cookie.Value != "private-ticket" {
			t.Fatal("missing session")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Set-Cookie": {"login_aliyunid_sc=updated-session; Path=/; Secure; HttpOnly"}}, Body: io.NopCloser(strings.NewReader(response)), Request: req}, nil
	})
	r := gin.New()
	r.POST("/monitors/:id/session", h.ImportAliyunFilingSession)
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/monitors/1/session", strings.NewReader(`{"cookie":"login_aliyunid_ticket=private-ticket; login_aliyunid_sc=private-session"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 200 || strings.Contains(w.Body.String(), "private-") || strings.Contains(w.Body.String(), "credentials") {
		t.Fatalf("import: %d %s", w.Code, w.Body.String())
	}
	h.DB.First(&m, m.ID)
	if m.SessionState != "connected" || m.Credentials == "" || strings.Contains(m.Credentials, "private-ticket") || m.NodeID != "FIRST_AUDIT" || m.PendingNotice != "" {
		t.Fatal("session not safely initialized")
	}
	data, err := h.decryptSecret(m.Credentials)
	if err != nil || !strings.Contains(data, "updated-session") {
		t.Fatal("refreshed session not saved")
	}
	response = `{"code":200,"resultCode":"Success","data":{"baOrderId":"123456","progress":[{"nodeId":"ICP_AUDIT","title":"管局审核","status":20,"statusText":"审核中","isCurrentNode":true,"progressInfo":"已提交管局18个工作日"}]}}`
	h.runFilingChecks(t.Context())
	h.DB.First(&m, m.ID)
	if m.NodeID != "ICP_AUDIT" || !strings.Contains(m.PendingNotice, "阿里云初审") || !strings.Contains(m.PendingNotice, "管局审核") {
		t.Fatal("node transition not notified")
	}
	notice := m.PendingNotice
	response = strings.ReplaceAll(response, "18个", "19个")
	h.runFilingChecks(t.Context())
	h.DB.First(&m, m.ID)
	if m.PendingNotice != notice || m.ProgressInfo != "已提交管局19个工作日" {
		t.Fatal("elapsed days caused duplicate notification or stale details")
	}
	h.DB.Model(&m).Update("enabled", false)
	before := calls
	h.runFilingChecks(t.Context())
	if calls != before {
		t.Fatal("paused monitor queried upstream")
	}
	h.DB.Model(&m).Update("enabled", true)
	response = `{"code":201,"resultCode":"Frontend.Business.NeedLogin"}`
	h.runFilingChecks(t.Context())
	h.DB.First(&m, m.ID)
	if m.SessionState != "expired" || m.Credentials != "" || m.NodeID != "ICP_AUDIT" || !strings.Contains(m.PendingNotice, "更新会话") {
		t.Fatal("expiration lost progress or failed to request login")
	}
}

func TestAliyunFailedImportPreservesCredentialsAndRejectsWechat(t *testing.T) {
	h, _ := newTestHandler(t)
	m := model.FilingMonitor{Name: "备案", Provider: "aliyun", BaOrderID: "123456", Credentials: "old-encrypted-session", SessionState: "connected"}
	h.DB.Create(&m)
	h.DB.Create(&model.FilingMonitor{Name: "微信"})
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	http.DefaultTransport = aliyunTestTransport(func(req *http.Request) (*http.Response, error) { return nil, errors.New("private-ticket") })
	r := gin.New()
	r.POST("/monitors/:id/session", h.ImportAliyunFilingSession)
	r.POST("/monitors/:id/login", h.StartFilingLogin)
	for _, path := range []string{"/monitors/1/session", "/monitors/2/session", "/monitors/1/login"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", path, strings.NewReader(`{"cookie":"login_aliyunid_ticket=private-ticket; login_aliyunid_sc=private-session"}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != 400 || strings.Contains(w.Body.String(), "private-ticket") {
			t.Fatalf("wrong platform or credential leak: %d %s", w.Code, w.Body.String())
		}
	}
	h.DB.First(&m, m.ID)
	if m.Credentials != "old-encrypted-session" || m.SessionState != "connected" {
		t.Fatal("failed import replaced existing session")
	}
}

func TestAliyunResultKeepsProgressOnErrorsAndCorruptCredentialsExpire(t *testing.T) {
	h, _ := newTestHandler(t)
	m := model.FilingMonitor{Name: "备案", Provider: "aliyun", Enabled: true, SessionState: "connected"}
	h.DB.Create(&m)
	info := aliyun.ProgressNode{NodeID: "ICP_AUDIT", Title: "管局审核", Status: 20, StatusText: "审核中", ProgressInfo: "18个工作日"}
	if err := h.applyAliyunFilingResult(&m, info, nil); err != nil {
		t.Fatal(err)
	}
	if err := h.applyAliyunFilingResult(&m, aliyun.ProgressNode{}, errors.New("网络失败")); err != nil {
		t.Fatal(err)
	}
	if m.SessionState != "connected" || m.NodeID != "ICP_AUDIT" || m.Status == nil || *m.Status != 20 || m.PendingNotice != "" {
		t.Fatal("transient failure discarded progress")
	}
	m.Credentials = "invalid"
	if err := h.checkFiling(t.Context(), &m); err != nil {
		t.Fatal(err)
	}
	if m.SessionState != "expired" || !strings.Contains(m.PendingNotice, "阿里云") || strings.Contains(m.PendingNotice, "微信") {
		t.Fatal("wrong expired platform")
	}
	encoded, _ := json.Marshal(m)
	if strings.Contains(string(encoded), "credentials") {
		t.Fatal("session exposed")
	}
}

func TestAliyunFieldsPreserveWechatWhenRestoringPreviousBackup(t *testing.T) {
	source, _ := newTestHandler(t)
	if err := source.DB.Create(&model.FilingMonitor{Name: "原微信监控", Credentials: "encrypted-wechat-session", SessionState: "connected"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"provider", "ba_order_id", "node_id", "title", "progress_info"} {
		if err := source.DB.Exec(`ALTER TABLE filing_monitors DROP COLUMN "` + column + `"`).Error; err != nil {
			t.Fatal(err)
		}
	}
	backup := filepath.Join(t.TempDir(), "previous.db")
	if err := source.DB.Exec("VACUUM INTO ?", backup).Error; err != nil {
		t.Fatal(err)
	}
	target, _ := newTestHandler(t)
	tables, err := target.tableNames()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := target.restoreDatabase(backup, tables); err != nil {
		t.Fatal(err)
	}
	var restored model.FilingMonitor
	if err := target.DB.First(&restored).Error; err != nil {
		t.Fatal(err)
	}
	if restored.Provider != "wechat" || restored.BaOrderID != "" || restored.NodeID != "" || restored.Credentials != "encrypted-wechat-session" {
		t.Fatal("previous backup lost existing wechat monitor")
	}
	if err := source.DB.AutoMigrate(&model.FilingMonitor{}); err != nil {
		t.Fatal(err)
	}
	var migrated model.FilingMonitor
	if err := source.DB.First(&migrated).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.Provider != "wechat" || migrated.Credentials != "encrypted-wechat-session" {
		t.Fatal("existing monitor migration changed credentials or provider")
	}
}

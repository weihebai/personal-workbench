package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

func TestR2SettingMasksSecrets(t *testing.T) {
	h, _ := newTestHandler(t)
	if err := h.saveSetting(r2AccountKey, "acct"); err != nil {
		t.Fatal(err)
	}
	if err := h.saveSetting(r2BucketKey, "bucket"); err != nil {
		t.Fatal(err)
	}
	if err := h.saveSetting(r2CredentialIDKey, "ACCESSKEY1234567890"); err != nil {
		t.Fatal(err)
	}
	encrypted, err := h.encryptSecret("SECRETVALUE1234567890")
	if err != nil {
		t.Fatal(err)
	}
	if err := h.saveSetting(r2CredentialValueKey, encrypted); err != nil {
		t.Fatal(err)
	}
	if err := h.saveSetting(r2ConfiguredKey, "1"); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/settings/r2", nil)
	h.GetR2Setting(c)

	if w.Code != http.StatusOK {
		t.Fatalf("状态码 %d", w.Code)
	}
	body := w.Body.String()
	for _, secret := range []string{"SECRETVALUE1234567890", "ACCESSKEY1234567890", encrypted} {
		if strings.Contains(body, secret) {
			t.Fatalf("响应不应包含敏感值 %q: %s", secret, body)
		}
	}
	if !strings.Contains(body, "ACCE") {
		t.Fatalf("应返回脱敏后的 Access Key: %s", body)
	}
	if !strings.Contains(body, `"jurisdiction":""`) {
		t.Fatalf("应返回区域配置: %s", body)
	}
}

func TestR2SettingClear(t *testing.T) {
	h, _ := newTestHandler(t)
	if err := h.saveSetting(r2ConfiguredKey, "1"); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/settings/r2", nil)
	h.DeleteR2Setting(c)

	if h.settingValue(r2ConfiguredKey) != "" {
		t.Fatal("清除后不应保留已配置标记")
	}
	var n int64
	h.DB.Model(&model.Setting{}).Where("`key` IN ?", r2SettingKeys).Count(&n)
	if n != 0 {
		t.Fatalf("应删除全部 R2 配置，还剩 %d 条", n)
	}
}

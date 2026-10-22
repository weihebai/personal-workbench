package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestSignParseTokenVersion(t *testing.T) {
	mgr := New("test-secret", time.Hour)
	token, err := mgr.Sign(7, "admin", 3)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	claims, err := mgr.Parse(token)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if claims.UID != 7 || claims.Name != "admin" || claims.Version != 3 {
		t.Fatalf("claims = %+v", claims)
	}
}

// 登出后 token_version 自增，旧 token 必须被中间件拒绝。
func TestMiddlewareRejectsStaleVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mgr := New("test-secret", time.Hour)
	token, err := mgr.Sign(7, "admin", 0)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	currentVersion := 0
	r := gin.New()
	r.Use(mgr.Middleware(func(uid uint, version int) bool {
		return uid == 7 && version == currentVersion
	}))
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })

	serve := func() int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	if code := serve(); code != http.StatusOK {
		t.Fatalf("当前版本应放行，得到 %d", code)
	}
	currentVersion = 1
	if code := serve(); code != http.StatusUnauthorized {
		t.Fatalf("版本已变化应拒绝，得到 %d", code)
	}
}

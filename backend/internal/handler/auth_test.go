package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"personal-workbench/internal/auth"
	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// 登出必须让旧 token 立刻失效，而不是等过期；
// 重新登录拿到的 token 又要能正常用，否则等于把人锁在门外。
func TestLogoutRevokesOldToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := newTestHandler(t)
	if err := h.DB.AutoMigrate(&model.User{}, &model.LoginAttempt{}); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("pass123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("生成密码哈希失败: %v", err)
	}
	if err := h.DB.Create(&model.User{Username: "admin", PasswordHash: string(hash)}).Error; err != nil {
		t.Fatalf("建用户失败: %v", err)
	}

	mgr := auth.New("test-secret", time.Hour)
	ah := NewAuthHandler(h, mgr)

	r := gin.New()
	r.POST("/login", ah.Login)
	authed := r.Group("")
	authed.Use(mgr.Middleware(ah.TokenValid))
	authed.GET("/me", ah.Me)
	authed.POST("/logout", ah.Logout)

	do := func(method, path, token string) *httptest.ResponseRecorder {
		var body *bytes.Buffer
		if path == "/login" {
			body = bytes.NewBufferString(`{"username":"admin","password":"pass123"}`)
		} else {
			body = bytes.NewBuffer(nil)
		}
		req := httptest.NewRequest(method, path, body)
		if path == "/login" {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	login := func() string {
		w := do(http.MethodPost, "/login", "")
		if w.Code != http.StatusOK {
			t.Fatalf("登录失败: %d %s", w.Code, w.Body.String())
		}
		var out struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Token == "" {
			t.Fatalf("解析 token 失败: %v %s", err, w.Body.String())
		}
		return out.Token
	}

	oldToken := login()
	if w := do(http.MethodGet, "/me", oldToken); w.Code != http.StatusOK {
		t.Fatalf("登出前 token 应可用，得到 %d", w.Code)
	}
	if w := do(http.MethodPost, "/logout", oldToken); w.Code != http.StatusOK {
		t.Fatalf("登出失败: %d %s", w.Code, w.Body.String())
	}
	if w := do(http.MethodGet, "/me", oldToken); w.Code != http.StatusUnauthorized {
		t.Fatalf("登出后旧 token 应 401，得到 %d", w.Code)
	}

	newToken := login()
	if newToken == oldToken {
		t.Fatal("重新登录应签发新 token")
	}
	if w := do(http.MethodGet, "/me", newToken); w.Code != http.StatusOK {
		t.Fatalf("重新登录后的 token 应可用，得到 %d %s", w.Code, w.Body.String())
	}
}

// 失败提示要给出剩余次数，并在第 5 次失败时当场锁定，而不是等下一次请求。
func TestLoginFailureShowsRemainingAttempts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := newTestHandler(t)
	if err := h.DB.AutoMigrate(&model.User{}, &model.LoginAttempt{}); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("pass123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("生成密码哈希失败: %v", err)
	}
	if err := h.DB.Create(&model.User{Username: "admin", PasswordHash: string(hash)}).Error; err != nil {
		t.Fatalf("建用户失败: %v", err)
	}

	ah := NewAuthHandler(h, auth.New("test-secret", time.Hour))
	r := gin.New()
	r.POST("/login", ah.Login)

	login := func(password string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/login",
			bytes.NewBufferString(`{"username":"admin","password":"`+password+`"}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	for i, want := range []string{"还可尝试 4 次", "还可尝试 3 次", "还可尝试 2 次", "还可尝试 1 次"} {
		w := login("wrong")
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("第 %d 次失败应 401，得到 %d %s", i+1, w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), want) {
			t.Fatalf("第 %d 次失败应提示 %q，得到 %s", i+1, want, w.Body.String())
		}
	}

	w := login("wrong")
	if w.Code != http.StatusTooManyRequests || !strings.Contains(w.Body.String(), "尝试次数过多") {
		t.Fatalf("第 5 次失败应当场锁定，得到 %d %s", w.Code, w.Body.String())
	}
	if w := login("pass123"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("锁定期内正确密码也应被拒，得到 %d %s", w.Code, w.Body.String())
	}
}

// 怀疑密码泄露时改密码必须把旧会话踢掉，否则旧 token 还能用到自然过期。
func TestChangePasswordRevokesOldToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := newTestHandler(t)
	if err := h.DB.AutoMigrate(&model.User{}, &model.LoginAttempt{}); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("oldpass"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("生成密码哈希失败: %v", err)
	}
	user := model.User{Username: "admin", PasswordHash: string(hash)}
	if err := h.DB.Create(&user).Error; err != nil {
		t.Fatalf("建用户失败: %v", err)
	}

	mgr := auth.New("test-secret", time.Hour)
	ah := NewAuthHandler(h, mgr)
	r := gin.New()
	r.POST("/login", ah.Login)
	authed := r.Group("")
	authed.Use(mgr.Middleware(ah.TokenValid))
	authed.GET("/me", ah.Me)
	authed.POST("/password", ah.ChangePassword)

	do := func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	login := func(password string) (string, int) {
		w := do(http.MethodPost, "/login", "", `{"username":"admin","password":"`+password+`"}`)
		if w.Code != http.StatusOK {
			return "", w.Code
		}
		var out struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Token == "" {
			t.Fatalf("解析 token 失败: %v %s", err, w.Body.String())
		}
		return out.Token, w.Code
	}

	oldToken, _ := login("oldpass")
	w := do(http.MethodPost, "/password", oldToken, `{"oldPassword":"oldpass","newPassword":"newpass"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("改密码失败: %d %s", w.Code, w.Body.String())
	}

	if w := do(http.MethodGet, "/me", oldToken, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("改密码后旧 token 应 401，得到 %d", w.Code)
	}
	if _, code := login("oldpass"); code != http.StatusUnauthorized {
		t.Fatalf("旧密码应登录失败，得到 %d", code)
	}
	newToken, code := login("newpass")
	if code != http.StatusOK {
		t.Fatalf("新密码应能登录，得到 %d", code)
	}
	if w := do(http.MethodGet, "/me", newToken, ""); w.Code != http.StatusOK {
		t.Fatalf("新 token 应可用，得到 %d %s", w.Code, w.Body.String())
	}

	var fresh model.User
	if err := h.DB.First(&fresh, user.ID).Error; err != nil {
		t.Fatalf("读用户失败: %v", err)
	}
	if fresh.TokenVersion != 1 {
		t.Fatalf("token_version = %d, want 1", fresh.TokenVersion)
	}
}

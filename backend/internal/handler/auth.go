package handler

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"personal-workbench/internal/auth"
	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthHandler struct {
	*Handler
	Mgr     *auth.Manager
	limiter *loginLimiter
}

func NewAuthHandler(h *Handler, mgr *auth.Manager) *AuthHandler {
	return &AuthHandler{
		Handler: h,
		Mgr:     mgr,
		limiter: newLoginLimiter(h.DB, 5, 10*time.Minute),
	}
}

// TokenValid 鉴权时的附加校验：登出会自增 token_version，
// 旧 token 即使没过期也会在这里被拒绝。
func (h *AuthHandler) TokenValid(uid uint, version int) bool {
	var u model.User
	if err := h.DB.Select("id", "token_version").First(&u, uid).Error; err != nil {
		return false
	}
	return u.TokenVersion == version
}

func (h *AuthHandler) Login(c *gin.Context) {
	ip := c.ClientIP()
	if ok, wait := h.limiter.Allow(ip); !ok {
		fail(c, http.StatusTooManyRequests, "尝试次数过多，请 "+wait.Round(time.Second).String()+" 后再试")
		return
	}

	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请输入用户名和密码")
		return
	}

	var u model.User
	err := h.DB.Where("username = ?", strings.TrimSpace(req.Username)).First(&u).Error
	if err != nil {
		h.loginFailed(c, ip)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
		h.loginFailed(c, ip)
		return
	}

	token, err := h.Mgr.Sign(u.ID, u.Username, u.TokenVersion)
	if err != nil {
		serverErr(c, err)
		return
	}
	h.limiter.Reset(ip)
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user": gin.H{
			"id": u.ID, "username": u.Username, "nickname": u.Nickname,
		},
	})
}

// loginFailed 计一次失败并告知剩余次数；达到阈值当次就进入锁定。
func (h *AuthHandler) loginFailed(c *gin.Context, ip string) {
	remaining, lockedFor := h.limiter.Fail(ip)
	if lockedFor > 0 {
		fail(c, http.StatusTooManyRequests, "尝试次数过多，请 "+lockedFor.Round(time.Second).String()+" 后再试")
		return
	}
	if remaining > 0 {
		fail(c, http.StatusUnauthorized, fmt.Sprintf("用户名或密码错误，还可尝试 %d 次", remaining))
		return
	}
	fail(c, http.StatusUnauthorized, "用户名或密码错误")
}

// Logout 自增 token 版本，使该账号已签发的所有 token 立即失效。
func (h *AuthHandler) Logout(c *gin.Context) {
	uid := c.GetUint("uid")
	if err := h.DB.Model(&model.User{}).
		Where("id = ?", uid).
		UpdateColumn("token_version", gorm.Expr("token_version + 1")).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AuthHandler) Me(c *gin.Context) {
	uid := c.GetUint("uid")
	var u model.User
	if err := h.DB.First(&u, uid).Error; err != nil {
		notFound(c, "用户不存在")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": u.ID, "username": u.Username, "nickname": u.Nickname, "avatar": u.Avatar,
	})
}

func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req struct {
		OldPassword string `json:"oldPassword" binding:"required"`
		NewPassword string `json:"newPassword" binding:"required,min=6"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "新密码至少 6 位")
		return
	}
	uid := c.GetUint("uid")
	var u model.User
	if err := h.DB.First(&u, uid).Error; err != nil {
		notFound(c, "用户不存在")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.OldPassword)) != nil {
		fail(c, http.StatusUnauthorized, "原密码错误")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		serverErr(c, err)
		return
	}
	// 改密码同时提升 token 版本：怀疑泄露时改密码才有意义，
	// 否则旧 token 还能一直用到自然过期。
	if err := h.DB.Model(&u).Updates(map[string]any{
		"password_hash": string(hash),
		"token_version": gorm.Expr("token_version + 1"),
	}).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// EnsureAdmin 库中无用户时创建初始账号；已存在用户则跳过
func EnsureAdmin(db *gorm.DB, username, password string) (bool, error) {
	var count int64
	if err := db.Model(&model.User{}).Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return false, err
	}
	u := model.User{Username: username, PasswordHash: string(hash), Nickname: "我"}
	if err := db.Create(&u).Error; err != nil {
		return false, err
	}
	return true, nil
}

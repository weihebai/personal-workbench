package handler

import (
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
	Limiter *auth.Limiter
	// 从配置派生的管理员账号，仅在库中无用户时用于初始化
	AdminUser string
	AdminPass string
}

func (h *AuthHandler) Login(c *gin.Context) {
	ip := c.ClientIP()
	if ok, wait := h.Limiter.Allow(ip); !ok {
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
		h.Limiter.Fail(ip)
		fail(c, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
		h.Limiter.Fail(ip)
		fail(c, http.StatusUnauthorized, "用户名或密码错误")
		return
	}

	token, err := h.Mgr.Sign(u.ID, u.Username)
	if err != nil {
		serverErr(c, err)
		return
	}
	h.Limiter.Reset(ip)
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user": gin.H{
			"id": u.ID, "username": u.Username, "nickname": u.Nickname,
		},
	})
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
	if err := h.DB.Model(&u).Update("password_hash", string(hash)).Error; err != nil {
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

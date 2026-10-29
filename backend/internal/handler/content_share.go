package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

const publicShareGone = "分享不存在或已失效"

// newShareToken 32 字节随机数 → 64 位小写十六进制。
// 256 位熵，猜不出来；数据库唯一索引兜底碰撞。
func newShareToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// shareExpiry 把「有效天数」换算成到期时间；0 表示永久（nil）。
func shareExpiry(days int, now time.Time) (*time.Time, bool) {
	switch days {
	case 0:
		return nil, true
	case 7, 30:
		t := now.AddDate(0, 0, days)
		return &t, true
	default:
		return nil, false
	}
}

func (h *Handler) contentWithID(c *gin.Context) (*model.Content, bool) {
	return h.findContent(c)
}

func (h *Handler) respondContentDetail(c *gin.Context, item model.Content) {
	list := []model.Content{item}
	h.decorateContents(list, true)
	c.JSON(http.StatusOK, list[0])
}

// ShareContent 生成分享链接。
//
//	无 Token          → 生成新 Token
//	有效 Token        → 保留 Token，只更新有效期（可延长/缩短/改永久）
//	已过期 Token      → 换新 Token，旧链接保持失效
func (h *Handler) ShareContent(c *gin.Context) {
	cur, ok := h.contentWithID(c)
	if !ok {
		return
	}
	var in struct {
		ExpiresInDays int `json:"expiresInDays"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	expiresAt, valid := shareExpiry(in.ExpiresInDays, time.Now())
	if !valid {
		badRequest(c, "有效期只能是永久、7 天或 30 天")
		return
	}

	token := ""
	if cur.ShareToken != nil {
		token = *cur.ShareToken
	}
	expired := cur.ShareExpiresAt != nil && !cur.ShareExpiresAt.After(time.Now())
	if token == "" || expired {
		fresh, err := newShareToken()
		if err != nil {
			serverErr(c, err)
			return
		}
		token = fresh
	}

	if err := h.DB.Model(cur).Updates(map[string]any{
		"share_token":      token,
		"share_expires_at": expiresAt,
	}).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(cur, cur.ID)
	h.respondContentDetail(c, *cur)
}

// RotateContentShare 换一个新 Token，保留当前到期时间；旧链接立即失效。
func (h *Handler) RotateContentShare(c *gin.Context) {
	cur, ok := h.contentWithID(c)
	if !ok {
		return
	}
	if cur.ShareToken == nil || *cur.ShareToken == "" {
		badRequest(c, "还没有分享链接，请先生成")
		return
	}
	if cur.ShareExpiresAt != nil && !cur.ShareExpiresAt.After(time.Now()) {
		badRequest(c, "分享已过期，请重新生成")
		return
	}
	token, err := newShareToken()
	if err != nil {
		serverErr(c, err)
		return
	}
	if err := h.DB.Model(cur).Update("share_token", token).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(cur, cur.ID)
	h.respondContentDetail(c, *cur)
}

// RevokeContentShare 撤销分享：Token 与到期时间一起清空，公开链接立刻 404。
func (h *Handler) RevokeContentShare(c *gin.Context) {
	cur, ok := h.contentWithID(c)
	if !ok {
		return
	}
	if err := h.DB.Model(cur).Updates(map[string]any{
		"share_token": nil, "share_expires_at": nil,
	}).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(cur, cur.ID)
	h.respondContentDetail(c, *cur)
}

type publicAttachment struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type publicContent struct {
	Title       string             `json:"title"`
	Body        string             `json:"body"`
	Tags        []string           `json:"tags"`
	UpdatedAt   time.Time          `json:"updatedAt"`
	Attachments []publicAttachment `json:"attachments"`
}

// GetPublicContent 公开只读接口，不经过 JWT。
// 所有失败（格式不对 / 不存在 / 已撤销 / 已过期 / 已删除 / 已轮换）
// 统一返回同样的 404，避免暴露分享状态。
func (h *Handler) GetPublicContent(c *gin.Context) {
	// 先设头：404 也不能被缓存或被搜索引擎收录
	c.Header("Cache-Control", "no-store")
	c.Header("X-Robots-Tag", "noindex, nofollow, noarchive")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")

	token := c.Param("token")
	if len(token) != 64 {
		notFound(c, publicShareGone)
		return
	}

	var item model.Content
	if err := h.DB.Where("share_token = ?", token).First(&item).Error; err != nil {
		notFound(c, publicShareGone)
		return
	}
	if item.ShareExpiresAt != nil && !item.ShareExpiresAt.After(time.Now()) {
		notFound(c, publicShareGone)
		return
	}

	var atts []model.Attachment
	h.DB.Select("hash, width, height").Where("content_id = ?", item.ID).Order("id ASC").Find(&atts)
	views := make([]publicAttachment, 0, len(atts))
	for _, a := range atts {
		views = append(views, publicAttachment{
			URL:    "/api/attachments/" + a.Hash + "/raw",
			Width:  a.Width,
			Height: a.Height,
		})
	}

	tags := splitTags(item.Tags)
	if tags == nil {
		tags = []string{}
	}

	c.JSON(http.StatusOK, publicContent{
		Title:       item.Title,
		Body:        item.Body,
		Tags:        tags,
		UpdatedAt:   item.UpdatedAt,
		Attachments: views,
	})
}

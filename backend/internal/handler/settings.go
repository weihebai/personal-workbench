package handler

// 设置相关的接口。存储用 model.Setting 键值表：
// - MCP 令牌：单独的接口，语义特殊（可清除、回退环境变量）
// - 通用设置：走白名单，前端传了没定义的键直接忽略，脏数据进不了库

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"personal-workbench/internal/model"
	"personal-workbench/internal/storage"

	"github.com/gin-gonic/gin"
)

// MCP 令牌放在设置表里（设置页可查看/重置）；MCP_TOKEN 环境变量作为兜底，
// 兼容纯环境变量部署的用法。设置页保存空值 = 删掉库里这条，回到环境变量/关闭状态。
const mcpTokenKey = "mcp_token"

// McpToken 当前生效的 MCP 令牌：库里有用库里的，否则回退环境变量
func (h *Handler) McpToken() string {
	var s model.Setting
	if err := h.DB.First(&s, "key = ?", mcpTokenKey).Error; err == nil && s.Value != "" {
		return s.Value
	}
	return os.Getenv("MCP_TOKEN")
}

// GetMcpSetting 设置页展示用：返回令牌原文（本工作台单用户，登录后可见与导出备份同级）
func (h *Handler) GetMcpSetting(c *gin.Context) {
	tok := h.McpToken()
	source := "env"
	if tok == "" {
		source = "off"
	} else {
		var s model.Setting
		if err := h.DB.First(&s, "key = ?", mcpTokenKey).Error; err == nil && s.Value != "" {
			source = "db"
		}
	}
	c.JSON(http.StatusOK, gin.H{"token": tok, "source": source})
}

// UpdateMcpSetting 设置/清除 MCP 令牌；token 传空字符串 = 清除
func (h *Handler) UpdateMcpSetting(c *gin.Context) {
	var in struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	tok := strings.TrimSpace(in.Token)
	if tok != "" && len(tok) < 16 {
		badRequest(c, "令牌太短，至少 16 位（建议用页面上的「生成新令牌」）")
		return
	}
	if tok == "" {
		h.DB.Delete(&model.Setting{}, "key = ?", mcpTokenKey)
	} else {
		h.DB.Save(&model.Setting{Key: mcpTokenKey, Value: tok})
	}
	c.JSON(http.StatusOK, gin.H{"token": h.McpToken()})
}

type r2Input struct {
	AccountID       string `json:"accountId"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	Jurisdiction    string `json:"jurisdiction"`
}

var r2SettingKeys = []string{
	r2AccountKey, r2BucketKey, r2CredentialIDKey, r2CredentialValueKey, r2JurisdictionKey, r2ConfiguredKey,
}

func (in *r2Input) normalize() {
	in.AccountID = strings.TrimSpace(in.AccountID)
	in.Bucket = strings.TrimSpace(in.Bucket)
	in.AccessKeyID = strings.TrimSpace(in.AccessKeyID)
	in.SecretAccessKey = strings.TrimSpace(in.SecretAccessKey)
	in.Jurisdiction = strings.TrimSpace(in.Jurisdiction)
}

func (in r2Input) config() storage.R2Config {
	return storage.R2Config{
		AccountID:       in.AccountID,
		Bucket:          in.Bucket,
		AccessKeyID:     in.AccessKeyID,
		SecretAccessKey: in.SecretAccessKey,
		Jurisdiction:    in.Jurisdiction,
	}
}

func (h *Handler) GetR2Setting(c *gin.Context) {
	c.JSON(http.StatusOK, h.r2SettingView())
}

func (h *Handler) TestR2Setting(c *gin.Context) {
	var in r2Input
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	in.normalize()
	cfg := in.config()
	if cfg.AccessKeyID == "" {
		cfg.AccessKeyID = h.settingValue(r2CredentialIDKey)
	}
	if cfg.Jurisdiction == "" {
		cfg.Jurisdiction = h.settingValue(r2JurisdictionKey)
	}
	if cfg.SecretAccessKey == "" {
		secret, err := h.decryptSecret(h.settingValue(r2CredentialValueKey))
		if err != nil {
			serverErr(c, err)
			return
		}
		cfg.SecretAccessKey = secret
	}
	client, err := storage.NewR2(cfg)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	if err := client.Check(ctx); err != nil {
		badRequest(c, "连接失败："+err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) UpdateR2Setting(c *gin.Context) {
	var in r2Input
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	in.normalize()
	cfg := in.config()
	if cfg.AccountID == "" || cfg.Bucket == "" {
		badRequest(c, "Account ID、Bucket 不能为空")
		return
	}
	if cfg.Jurisdiction != "" && cfg.Jurisdiction != "eu" {
		badRequest(c, "区域只能是默认或 EU")
		return
	}
	if cfg.AccessKeyID == "" {
		cfg.AccessKeyID = h.settingValue(r2CredentialIDKey)
	}
	if cfg.AccessKeyID == "" {
		badRequest(c, "Access Key ID 不能为空")
		return
	}
	var r2Files int64
	h.DB.Model(&model.Attachment{}).Where("storage = ?", "r2").Count(&r2Files)
	if r2Files > 0 &&
		(cfg.AccountID != h.settingValue(r2AccountKey) || cfg.Bucket != h.settingValue(r2BucketKey)) {
		badRequest(c, "已有图片存储在 R2，不能更换 Account ID 或 Bucket")
		return
	}
	secret := cfg.SecretAccessKey
	if secret == "" {
		stored, err := h.decryptSecret(h.settingValue(r2CredentialValueKey))
		if err != nil {
			serverErr(c, err)
			return
		}
		secret = stored
	}
	if secret == "" {
		badRequest(c, "Secret Access Key 不能为空")
		return
	}
	cfg.SecretAccessKey = secret

	client, err := storage.NewR2(cfg)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	if err := client.Check(ctx); err != nil {
		badRequest(c, "连接失败："+err.Error())
		return
	}

	encrypted, err := h.encryptSecret(secret)
	if err != nil {
		serverErr(c, err)
		return
	}
	for key, value := range map[string]string{
		r2AccountKey:         cfg.AccountID,
		r2BucketKey:          cfg.Bucket,
		r2CredentialIDKey:    cfg.AccessKeyID,
		r2CredentialValueKey: encrypted,
		r2JurisdictionKey:    cfg.Jurisdiction,
		r2ConfiguredKey:      "1",
	} {
		if err := h.saveSetting(key, value); err != nil {
			serverErr(c, err)
			return
		}
	}
	h.GetR2Setting(c)
}

func (h *Handler) DeleteR2Setting(c *gin.Context) {
	var r2Files int64
	h.DB.Model(&model.Attachment{}).Where("storage = ?", "r2").Count(&r2Files)
	if r2Files > 0 {
		badRequest(c, "已有图片存储在 R2，不能清除配置；请先迁移或删除这些图片")
		return
	}
	for _, key := range r2SettingKeys {
		if err := h.saveSetting(key, ""); err != nil {
			serverErr(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func maskSecret(v string) string {
	if len(v) <= 8 {
		return "••••••••"
	}
	return v[:4] + "••••••••" + v[len(v)-4:]
}

func (h *Handler) r2SettingView() gin.H {
	configured := h.settingValue(r2ConfiguredKey) == "1"
	accessKey := ""
	if configured {
		accessKey = maskSecret(h.settingValue(r2CredentialIDKey))
	}
	return gin.H{
		"configured":        configured,
		"accountId":         h.settingValue(r2AccountKey),
		"bucket":            h.settingValue(r2BucketKey),
		"accessKeyIdMasked": accessKey,
		"jurisdiction":      h.settingValue(r2JurisdictionKey),
	}
}

// ---------- 通用设置 ----------

type settingDef struct {
	def  string
	norm func(string) string
}

var settingDefs = map[string]settingDef{
	// 收款账期（天）：确认收货后 N 天没到账算逾期
	"paymentCreditDays": {
		def: strconv.Itoa(defaultCreditDays),
		norm: func(v string) string {
			n, err := strconv.Atoi(strings.TrimSpace(v))
			if err != nil || n <= 0 || n > 365 {
				return strconv.Itoa(defaultCreditDays)
			}
			return strconv.Itoa(n)
		},
	},
}

func (h *Handler) GetSettings(c *gin.Context) {
	rows := []model.Setting{}
	h.DB.Find(&rows)
	vals := map[string]string{}
	for _, r := range rows {
		vals[r.Key] = r.Value
	}
	out := map[string]string{}
	for k, d := range settingDefs {
		if v, ok := vals[k]; ok && strings.TrimSpace(v) != "" {
			out[k] = d.norm(v)
		} else {
			out[k] = d.def
		}
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) UpdateSettings(c *gin.Context) {
	var in map[string]string
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	for k, v := range in {
		d, ok := settingDefs[k]
		if !ok {
			continue
		}
		val := d.norm(v)
		var s model.Setting
		if err := h.DB.Where("`key` = ?", k).First(&s).Error; err != nil {
			s = model.Setting{Key: k}
		}
		s.Value = val
		if err := h.DB.Save(&s).Error; err != nil {
			serverErr(c, err)
			return
		}
	}
	h.GetSettings(c)
}

package handler

// 设置相关的接口。存储用 model.Setting 键值表：
// - MCP 令牌：单独的接口，语义特殊（可清除、回退环境变量）
// - 通用设置：走白名单，前端传了没定义的键直接忽略，脏数据进不了库

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"personal-workbench/internal/model"

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

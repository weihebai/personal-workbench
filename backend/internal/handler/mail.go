package handler

// 到期提醒的邮件通知：SMTP 配置存设置表，密码沿用 R2 的本地密钥加密。
// 后台每小时检查一次，同一条提醒每天最多发一封；提醒、过期但当天已发过的不再重复。

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"personal-workbench/internal/model"
	"personal-workbench/internal/notify"

	"github.com/gin-gonic/gin"
)

const (
	smtpHostKey     = "smtp_host"
	smtpPortKey     = "smtp_port"
	smtpUsernameKey = "smtp_username"
	smtpPasswordKey = "smtp_password"
	smtpFromKey     = "smtp_from"
	smtpToKey       = "smtp_to"
	smtpSSLKey      = "smtp_ssl"
	smtpEnabledKey  = "smtp_enabled"
)

var smtpSettingKeys = []string{
	smtpHostKey, smtpPortKey, smtpUsernameKey, smtpPasswordKey,
	smtpFromKey, smtpToKey, smtpSSLKey, smtpEnabledKey,
}

type smtpInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	To       string `json:"to"`
	SSL      bool   `json:"ssl"`
	Enabled  bool   `json:"enabled"`
}

func (in *smtpInput) normalize() {
	in.Host = strings.TrimSpace(in.Host)
	in.Username = strings.TrimSpace(in.Username)
	in.Password = strings.TrimSpace(in.Password)
	in.From = strings.TrimSpace(in.From)
	in.To = strings.TrimSpace(in.To)
	if in.Port == 0 {
		if in.SSL {
			in.Port = 465
		} else {
			in.Port = 587
		}
	}
}

func (in smtpInput) recipients() []string {
	out := []string{}
	for _, s := range strings.FieldsFunc(in.To, func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
		if v := strings.TrimSpace(s); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// 按当前设置拼出可用的邮件配置；password 传空时用库里已保存的。
func (h *Handler) smtpConfigWith(in smtpInput) (notify.Config, error) {
	password := in.Password
	if password == "" {
		stored, err := h.decryptSecret(h.settingValue(smtpPasswordKey))
		if err != nil {
			return notify.Config{}, err
		}
		password = stored
	}
	cfg := notify.Config{
		Host:     in.Host,
		Port:     in.Port,
		Username: in.Username,
		Password: password,
		From:     in.From,
		To:       in.recipients(),
		SSL:      in.SSL,
	}
	if err := cfg.Validate(); err != nil {
		return notify.Config{}, err
	}
	return cfg, nil
}

func (h *Handler) smtpConfig() (notify.Config, bool) {
	in := smtpInput{
		Host:     h.settingValue(smtpHostKey),
		Username: h.settingValue(smtpUsernameKey),
		From:     h.settingValue(smtpFromKey),
		To:       h.settingValue(smtpToKey),
		SSL:      h.settingValue(smtpSSLKey) == "1",
	}
	if in.Host == "" || in.To == "" || in.From == "" {
		return notify.Config{}, false
	}
	if p, err := strconv.Atoi(h.settingValue(smtpPortKey)); err == nil && p > 0 {
		in.Port = p
	}
	cfg, err := h.smtpConfigWith(in)
	if err != nil {
		return notify.Config{}, false
	}
	return cfg, true
}

func (h *Handler) smtpView() gin.H {
	cfg, configured := h.smtpConfig()
	port := cfg.Port
	if port == 0 {
		port = 587
		if h.settingValue(smtpSSLKey) == "1" {
			port = 465
		}
	}
	return gin.H{
		"configured":    configured,
		"enabled":       h.settingValue(smtpEnabledKey) == "1",
		"host":          h.settingValue(smtpHostKey),
		"port":          port,
		"username":      h.settingValue(smtpUsernameKey),
		"from":          h.settingValue(smtpFromKey),
		"to":            h.settingValue(smtpToKey),
		"ssl":           h.settingValue(smtpSSLKey) == "1",
		"passwordSaved": h.settingValue(smtpPasswordKey) != "",
	}
}

func (h *Handler) GetSmtpSetting(c *gin.Context) {
	c.JSON(http.StatusOK, h.smtpView())
}

func (h *Handler) UpdateSmtpSetting(c *gin.Context) {
	var in smtpInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	in.normalize()
	cfg, err := h.smtpConfigWith(in)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	if err := notify.Check(cfg); err != nil {
		badRequest(c, "连接失败："+err.Error())
		return
	}
	encrypted, err := h.encryptSecret(cfg.Password)
	if err != nil {
		serverErr(c, err)
		return
	}
	values := map[string]string{
		smtpHostKey:     cfg.Host,
		smtpPortKey:     strconv.Itoa(cfg.Port),
		smtpUsernameKey: cfg.Username,
		smtpPasswordKey: encrypted,
		smtpFromKey:     cfg.From,
		smtpToKey:       strings.Join(cfg.To, ","),
		smtpSSLKey:      boolFlag(cfg.SSL),
		smtpEnabledKey:  boolFlag(in.Enabled),
	}
	for k, v := range values {
		if err := h.saveSetting(k, v); err != nil {
			serverErr(c, err)
			return
		}
	}
	h.GetSmtpSetting(c)
}

func (h *Handler) TestSmtpSetting(c *gin.Context) {
	var in smtpInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	in.normalize()
	cfg, err := h.smtpConfigWith(in)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	subject := "工作台邮件通知测试"
	body := fmt.Sprintf("这是一封测试邮件，收到说明 SMTP 配置可用。\n\n发送时间：%s", time.Now().Format("2006-01-02 15:04:05"))
	if err := notify.Send(cfg, subject, body); err != nil {
		badRequest(c, "发送失败："+err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ClearSmtpSetting 关闭邮件通知并清空 SMTP 配置。
func (h *Handler) ClearSmtpSetting(c *gin.Context) {
	for _, key := range smtpSettingKeys {
		if err := h.saveSetting(key, ""); err != nil {
			serverErr(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func boolFlag(v bool) string {
	if v {
		return "1"
	}
	return ""
}

// RunReminderNotifier 启动后先检查一次，之后每小时检查。
func (h *Handler) RunReminderNotifier(ctx context.Context) {
	h.notifyReminders(ctx)
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.notifyReminders(ctx)
		}
	}
}

func (h *Handler) notifyReminders(ctx context.Context) {
	if h.settingValue(smtpEnabledKey) != "1" {
		return
	}
	cfg, ok := h.smtpConfig()
	if !ok {
		return
	}

	var items []model.Reminder
	if err := h.DB.Where("enabled = ?", true).Order("expire_at ASC").Find(&items).Error; err != nil {
		log.Printf("提醒邮件：读取提醒失败: %v", err)
		return
	}

	now := time.Now()
	today := now.Format("2006-01-02")
	due := dueReminders(items, now)
	if len(due) == 0 {
		return
	}

	subject, body := reminderMail(due, now)
	select {
	case <-ctx.Done():
		return
	default:
	}
	if err := notify.Send(cfg, subject, body); err != nil {
		log.Printf("提醒邮件发送失败: %v", err)
		return
	}

	ids := make([]uint, 0, len(due))
	for _, r := range due {
		ids = append(ids, r.ID)
	}
	if err := h.DB.Model(&model.Reminder{}).Where("id IN ?", ids).Update("notified_on", today).Error; err != nil {
		log.Printf("提醒邮件：更新发送记录失败: %v", err)
	}
	log.Printf("提醒邮件已发送：%d 项", len(due))
}

// dueReminders 选出今天该发的提醒：已过期，或已进入提前提醒天数；
// 同一天已经发过（NotifiedOn = 今天）的跳过。
func dueReminders(items []model.Reminder, now time.Time) []model.Reminder {
	today := now.Format("2006-01-02")
	out := make([]model.Reminder, 0, len(items))
	for _, r := range items {
		if r.NotifiedOn == today {
			continue
		}
		if now.After(r.ExpireAt) || now.AddDate(0, 0, r.RemindDays).After(r.ExpireAt) {
			out = append(out, r)
		}
	}
	return out
}

var reminderCategoryLabels = map[string]string{
	"certificate": "证书",
	"domain":      "域名",
	"server":      "服务器",
	"client":      "客户续费",
	"other":       "其他",
}

func reminderMail(items []model.Reminder, now time.Time) (subject, body string) {
	expired := 0
	lines := make([]string, 0, len(items))
	for _, r := range items {
		label := reminderCategoryLabels[r.Category]
		if label == "" {
			label = "其他"
		}
		days := int(r.ExpireAt.Sub(now).Hours() / 24)
		status := fmt.Sprintf("剩余 %d 天", days)
		if days < 0 {
			expired++
			status = fmt.Sprintf("已过期 %d 天", -days)
		} else if days == 0 {
			status = "今天到期"
		}

		var b strings.Builder
		fmt.Fprintf(&b, "[%s] %s（%s）\n", status, r.Title, label)
		fmt.Fprintf(&b, "  到期：%s\n", r.ExpireAt.Format("2006-01-02"))
		if r.Target != "" {
			fmt.Fprintf(&b, "  对象：%s\n", r.Target)
		}
		if r.Issuer != "" {
			fmt.Fprintf(&b, "  签发/服务商：%s\n", r.Issuer)
		}
		if r.Note != "" {
			fmt.Fprintf(&b, "  备注：%s\n", singleLine(r.Note))
		}
		lines = append(lines, b.String())
	}

	subject = fmt.Sprintf("工作台提醒：%d 项到期（已过期 %d 项）", len(items), expired)
	body = fmt.Sprintf("以下提醒已到提醒期或已过期（%s）：\n\n%s\n处理完可在工作台关闭提醒或顺延到期日。\n",
		now.Format("2006-01-02 15:04"), strings.Join(lines, "\n"))
	return subject, body
}

func singleLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

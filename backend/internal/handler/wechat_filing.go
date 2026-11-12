package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"personal-workbench/internal/aliyun"
	"personal-workbench/internal/model"
	"personal-workbench/internal/notify"
	"personal-workbench/internal/wechat"
)

type filingScan struct {
	client   *wechat.Client
	expires  time.Time
	state    string
	lastPoll time.Time
}

func (h *Handler) filingLock(id uint) *sync.Mutex {
	lock, _ := h.filingLocks.LoadOrStore(id, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

func (h *Handler) lockedFilingMonitor(c *gin.Context) (*model.FilingMonitor, bool, func()) {
	id, ok := paramUint(c, "id")
	if !ok {
		return nil, false, func() {}
	}
	lock := h.filingLock(id)
	lock.Lock()
	m, ok := h.filingMonitor(c)
	return m, ok, lock.Unlock
}

func (h *Handler) filingScan(id uint) *filingScan {
	h.filingMu.Lock()
	defer h.filingMu.Unlock()
	return h.filingScans[id]
}

func (h *Handler) clearFilingScan(id uint) {
	h.filingMu.Lock()
	defer h.filingMu.Unlock()
	delete(h.filingScans, id)
}

func (h *Handler) ListFilingMonitors(c *gin.Context) {
	var items = []model.FilingMonitor{}
	if err := h.DB.Order("created_at DESC").Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateFilingMonitor(c *gin.Context) {
	var in struct {
		Name      string `json:"name"`
		ProjectID *uint  `json:"projectId"`
		Provider  string `json:"provider"`
		BaOrderID string `json:"baOrderId"`
	}
	if c.ShouldBindJSON(&in) != nil {
		badRequest(c, "参数错误")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len([]rune(in.Name)) > 128 {
		badRequest(c, "请填写 1 至 128 字的监控名称")
		return
	}
	if in.Provider == "" {
		in.Provider = "wechat"
	}
	if in.Provider != "wechat" && in.Provider != "aliyun" {
		badRequest(c, "不支持的备案平台")
		return
	}
	if in.Provider == "aliyun" && !aliyun.ValidOrderID(in.BaOrderID) {
		badRequest(c, "请填写 1 至 32 位数字的阿里云订单号")
		return
	}
	if in.Provider == "wechat" && in.BaOrderID != "" {
		badRequest(c, "微信小程序不使用阿里云订单号")
		return
	}
	if in.ProjectID != nil {
		var project model.Project
		if h.DB.First(&project, *in.ProjectID).Error != nil {
			badRequest(c, "关联项目不存在")
			return
		}
	}
	m := model.FilingMonitor{Name: in.Name, ProjectID: in.ProjectID, Provider: in.Provider, BaOrderID: in.BaOrderID, Enabled: true, SessionState: "disconnected"}
	if err := h.DB.Create(&m).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, m)
}

func (h *Handler) filingMonitor(c *gin.Context) (*model.FilingMonitor, bool) {
	id, ok := paramUint(c, "id")
	if !ok {
		return nil, false
	}
	var m model.FilingMonitor
	if h.DB.First(&m, id).Error != nil {
		notFound(c, "备案监控不存在")
		return nil, false
	}
	return &m, true
}

func (h *Handler) UpdateFilingMonitor(c *gin.Context) {
	m, ok, unlock := h.lockedFilingMonitor(c)
	defer unlock()
	if !ok {
		return
	}
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if c.ShouldBindJSON(&in) != nil || in.Enabled == nil {
		badRequest(c, "请指定是否启用监控")
		return
	}
	if err := h.DB.Model(m).Update("enabled", *in.Enabled).Error; err != nil {
		serverErr(c, err)
		return
	}
	m.Enabled = *in.Enabled
	c.JSON(http.StatusOK, m)
}

func (h *Handler) DeleteFilingMonitor(c *gin.Context) {
	m, ok, unlock := h.lockedFilingMonitor(c)
	defer unlock()
	if !ok {
		return
	}
	if err := h.DB.Model(m).Update("credentials", "").Error; err != nil {
		serverErr(c, err)
		return
	}
	if err := h.DB.Delete(m).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.clearFilingScan(m.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) StartFilingLogin(c *gin.Context) {
	m, ok, unlock := h.lockedFilingMonitor(c)
	defer unlock()
	if !ok {
		return
	}
	if m.Provider != "wechat" {
		badRequest(c, "阿里云备案请使用导入会话")
		return
	}
	client := wechat.NewClient()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	image, mime, err := client.StartLogin(ctx)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	expires := time.Now().Add(3 * time.Minute)
	h.filingMu.Lock()
	for id, s := range h.filingScans {
		if time.Now().After(s.expires) {
			delete(h.filingScans, id)
		}
	}
	if len(h.filingScans) >= 10 && h.filingScans[m.ID] == nil {
		h.filingMu.Unlock()
		badRequest(c, "同时登录过多，请稍后重试")
		return
	}
	if h.filingScans == nil {
		h.filingScans = make(map[uint]*filingScan)
	}
	h.filingScans[m.ID] = &filingScan{client: client, expires: expires, state: "waiting"}
	h.filingMu.Unlock()
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"state": "waiting", "expiresAt": expires, "qrCode": "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(image)})
}

func (h *Handler) PollFilingLogin(c *gin.Context) {
	m, ok, unlock := h.lockedFilingMonitor(c)
	defer unlock()
	if !ok {
		return
	}
	if m.Provider != "wechat" {
		badRequest(c, "阿里云备案不使用微信扫码")
		return
	}
	c.Header("Cache-Control", "no-store")
	s := h.filingScan(m.ID)
	if s == nil || time.Now().After(s.expires) {
		h.clearFilingScan(m.ID)
		c.JSON(http.StatusOK, gin.H{"state": "expired"})
		return
	}
	if s.state == "connected" || time.Since(s.lastPoll) < 2*time.Second {
		c.JSON(http.StatusOK, gin.H{"state": s.state})
		return
	}
	s.lastPoll = time.Now()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	state, err := s.client.PollLogin(ctx)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	s.state = state
	if state == "confirmed" {
		credentials, err := s.client.Credentials()
		if err != nil {
			badRequest(c, err.Error())
			return
		}
		account := ""
		for _, cookie := range credentials.Cookies {
			if cookie.Name == "slave_user" {
				account = cookie.Value
			}
		}
		if account == "" {
			badRequest(c, "微信未返回小程序账号标识，请重新扫码")
			return
		}
		if m.AccountID != "" && m.AccountID != account {
			h.clearFilingScan(m.ID)
			badRequest(c, "扫码账号与原监控账号不同，请选择原小程序，或新建监控")
			return
		}
		data, err := json.Marshal(credentials)
		if err != nil {
			serverErr(c, err)
			return
		}
		secret, err := h.encryptSecret(string(data))
		if err != nil {
			serverErr(c, err)
			return
		}
		info, queryErr := s.client.Filing(ctx)
		if queryErr != nil {
			badRequest(c, queryErr.Error())
			return
		}
		m.Credentials = secret
		m.AccountID = account
		m.SessionState = "connected"
		if err = h.applyFilingResult(m, info, nil); err != nil {
			serverErr(c, err)
			return
		}
		s.state = "connected"
	}
	c.JSON(http.StatusOK, gin.H{"state": s.state})
}

func (h *Handler) CheckFilingMonitor(c *gin.Context) {
	m, ok, unlock := h.lockedFilingMonitor(c)
	defer unlock()
	if !ok {
		return
	}
	if m.SessionState != "connected" {
		badRequest(c, "请先完成备案平台登录")
		return
	}
	if err := h.checkFiling(c.Request.Context(), m); err != nil {
		serverErr(c, err)
		return
	}
	h.sendFilingNotice(m)
	c.JSON(http.StatusOK, m)
}

func (h *Handler) checkFiling(ctx context.Context, m *model.FilingMonitor) error {
	if m.Provider == "aliyun" {
		return h.checkAliyunFiling(ctx, m)
	}
	if m.Provider != "wechat" {
		return errors.New("不支持的备案平台")
	}
	data, err := h.decryptSecret(m.Credentials)
	if err != nil {
		return h.applyFilingResult(m, wechat.FilingInfo{}, fmt.Errorf("%w（登录凭据无法解密）", wechat.ErrExpired))
	}
	var credentials wechat.Credentials
	if json.Unmarshal([]byte(data), &credentials) != nil {
		return h.applyFilingResult(m, wechat.FilingInfo{}, fmt.Errorf("%w（登录凭据格式异常）", wechat.ErrExpired))
	}
	client, err := wechat.Restore(credentials)
	if err != nil {
		return h.applyFilingResult(m, wechat.FilingInfo{}, err)
	}
	info, queryErr := client.Filing(ctx)
	if queryErr == nil {
		credentials, err = client.Credentials()
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(credentials)
		if err != nil {
			return err
		}
		m.Credentials, err = h.encryptSecret(string(encoded))
		if err != nil {
			return err
		}
	}
	return h.applyFilingResult(m, info, queryErr)
}

func (h *Handler) applyFilingResult(m *model.FilingMonitor, info wechat.FilingInfo, queryErr error) error {
	now := time.Now()
	m.LastCheckedAt = &now
	if queryErr != nil {
		m.LastError = queryErr.Error()
		if errors.Is(queryErr, wechat.ErrExpired) {
			if m.SessionState != "expired" {
				m.PendingNotice += fmt.Sprintf("%s：微信登录已失效，请在工作台重新扫码。\n", m.Name)
			}
			m.SessionState = "expired"
			m.Credentials = ""
		}
	} else {
		if m.Status != nil && *m.Status != info.Status {
			m.PendingNotice += fmt.Sprintf("%s：备案状态由「%s」变为「%s」。\n", m.Name, m.StatusText, info.StatusText)
		}
		m.Status = &info.Status
		m.StatusText = info.StatusText
		m.LastError = ""
		m.LastSuccessAt = &now
		m.SessionState = "connected"
	}
	return h.DB.Save(m).Error
}

func (h *Handler) sendFilingNotice(m *model.FilingMonitor) {
	if m.PendingNotice == "" || h.settingValue(smtpEnabledKey) != "1" {
		return
	}
	cfg, ok := h.smtpConfig()
	if !ok {
		return
	}
	if err := notify.Send(cfg, "工作台：备案监控通知", m.PendingNotice); err != nil {
		m.NotificationError = "邮件发送失败，将在下次检查时重试"
	} else {
		m.PendingNotice = ""
		m.NotificationError = ""
	}
	if err := h.DB.Model(m).Updates(map[string]any{"pending_notice": m.PendingNotice, "notification_error": m.NotificationError}).Error; err != nil {
		log.Printf("备案通知记录保存失败")
	}
}

func (h *Handler) RunFilingMonitor(ctx context.Context) {
	h.runFilingChecks(ctx)
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.runFilingChecks(ctx)
		}
	}
}

func (h *Handler) runFilingChecks(ctx context.Context) {
	var monitors []model.FilingMonitor
	if err := h.DB.Where("enabled = ?", true).Find(&monitors).Error; err != nil {
		log.Printf("读取备案监控失败")
		return
	}
	for i := range monitors {
		if ctx.Err() != nil {
			return
		}
		h.runFilingCheck(ctx, monitors[i].ID)
	}
}

func (h *Handler) runFilingCheck(ctx context.Context, id uint) {
	lock := h.filingLock(id)
	lock.Lock()
	defer lock.Unlock()
	var m model.FilingMonitor
	if h.DB.First(&m, id).Error != nil || !m.Enabled {
		return
	}
	if m.SessionState == "connected" {
		if err := h.checkFiling(ctx, &m); err != nil {
			log.Printf("备案监控 %d 保存失败", id)
		}
	}
	h.sendFilingNotice(&m)
}

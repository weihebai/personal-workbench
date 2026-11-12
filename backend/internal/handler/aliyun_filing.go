package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"personal-workbench/internal/aliyun"
	"personal-workbench/internal/model"
)

func (h *Handler) ImportAliyunFilingSession(c *gin.Context) {
	m, ok, unlock := h.lockedFilingMonitor(c)
	defer unlock()
	if !ok {
		return
	}
	if m.Provider != "aliyun" {
		badRequest(c, "只有阿里云备案支持导入会话")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 40<<10)
	var in struct {
		Cookie string `json:"cookie"`
	}
	if c.ShouldBindJSON(&in) != nil {
		badRequest(c, "会话参数错误或内容过长")
		return
	}
	client, err := aliyun.ImportCookie(in.Cookie)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	info, err := client.Progress(c.Request.Context(), m.BaOrderID)
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	if err := h.saveAliyunCredentials(m, client.Credentials()); err != nil {
		serverErr(c, err)
		return
	}
	if err := h.applyAliyunFilingResult(m, info, nil); err != nil {
		serverErr(c, err)
		return
	}
	h.sendFilingNotice(m)
	c.JSON(http.StatusOK, m)
}

func (h *Handler) saveAliyunCredentials(m *model.FilingMonitor, credentials aliyun.Credentials) error {
	data, err := json.Marshal(credentials)
	if err != nil {
		return err
	}
	m.Credentials, err = h.encryptSecret(string(data))
	return err
}

func (h *Handler) checkAliyunFiling(ctx context.Context, m *model.FilingMonitor) error {
	data, err := h.decryptSecret(m.Credentials)
	if err != nil {
		return h.applyAliyunFilingResult(m, aliyun.ProgressNode{}, aliyun.ErrExpired)
	}
	var credentials aliyun.Credentials
	if json.Unmarshal([]byte(data), &credentials) != nil {
		return h.applyAliyunFilingResult(m, aliyun.ProgressNode{}, aliyun.ErrExpired)
	}
	client, err := aliyun.Restore(credentials)
	if err != nil {
		return h.applyAliyunFilingResult(m, aliyun.ProgressNode{}, aliyun.ErrExpired)
	}
	info, queryErr := client.Progress(ctx, m.BaOrderID)
	if queryErr == nil {
		if err := h.saveAliyunCredentials(m, client.Credentials()); err != nil {
			return err
		}
	}
	return h.applyAliyunFilingResult(m, info, queryErr)
}

func (h *Handler) applyAliyunFilingResult(m *model.FilingMonitor, info aliyun.ProgressNode, queryErr error) error {
	now := time.Now()
	m.LastCheckedAt = &now
	if queryErr != nil {
		m.LastError = queryErr.Error()
		if errors.Is(queryErr, aliyun.ErrExpired) {
			if m.SessionState != "expired" {
				m.PendingNotice += fmt.Sprintf("%s：阿里云登录已失效，请重新登录并在工作台更新会话。\n", m.Name)
			}
			m.SessionState = "expired"
			m.Credentials = ""
		}
	} else {
		if m.Status != nil && (m.NodeID != info.NodeID || *m.Status != info.Status || m.StatusText != info.StatusText) {
			m.PendingNotice += fmt.Sprintf("%s：阿里云备案由「%s · %s」变为「%s · %s」。\n", m.Name, m.Title, m.StatusText, info.Title, info.StatusText)
		}
		m.NodeID = info.NodeID
		m.Title = info.Title
		m.Status = &info.Status
		m.StatusText = info.StatusText
		m.ProgressInfo = info.ProgressInfo
		m.LastError = ""
		m.LastSuccessAt = &now
		m.SessionState = "connected"
	}
	return h.DB.Save(m).Error
}

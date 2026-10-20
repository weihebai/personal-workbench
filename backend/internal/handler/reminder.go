package handler

import (
	"net/http"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

type reminderView struct {
	model.Reminder
	State       string `json:"state"` // normal / soon / expired
	DaysLeft    int    `json:"daysLeft"`
	ProjectName string `json:"projectName"`
}

func (h *Handler) ListReminders(c *gin.Context) {
	q := h.DB.Model(&model.Reminder{})
	if s := c.Query("category"); s != "" {
		q = q.Where("category = ?", s)
	}
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}
	if c.Query("enabled") == "1" {
		q = q.Where("enabled = ?", true)
	}
	var items []model.Reminder
	if err := q.Order("expire_at ASC").Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}

	projIDs := []uint{}
	for _, r := range items {
		if r.ProjectID != nil {
			projIDs = append(projIDs, *r.ProjectID)
		}
	}
	projName := map[uint]string{}
	if len(projIDs) > 0 {
		var ps []model.Project
		h.DB.Select("id, name").Where("id IN ?", projIDs).Find(&ps)
		for _, p := range ps {
			projName[p.ID] = p.Name
		}
	}

	views := make([]reminderView, 0, len(items))
	now := time.Now()
	for _, r := range items {
		days := int(time.Until(r.ExpireAt).Hours() / 24)
		state := "normal"
		if now.After(r.ExpireAt) {
			state = "expired"
		} else if now.AddDate(0, 0, r.RemindDays).After(r.ExpireAt) {
			state = "soon"
		}
		// 已过期时 days 为负数，用 daysLeft 表达剩余天数
		v := reminderView{Reminder: r, State: state, DaysLeft: days}
		if r.ProjectID != nil {
			v.ProjectName = projName[*r.ProjectID]
		}
		views = append(views, v)
	}
	c.JSON(http.StatusOK, gin.H{"items": views})
}

type reminderInput struct {
	Title      string  `json:"title"`
	Category   string  `json:"category"`
	ProjectID  *uint   `json:"projectId"`
	Target     string  `json:"target"`
	ExpireAt   string  `json:"expireAt"`
	RemindDays int     `json:"remindDays"`
	Issuer     string  `json:"issuer"`
	AutoRenew  bool    `json:"autoRenew"`
	Enabled    *bool   `json:"enabled"`
	Note       string  `json:"note"`
}

func (h *Handler) CreateReminder(c *gin.Context) {
	var in reminderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		badRequest(c, "提醒名称必填")
		return
	}
	exp := mustParseDate(in.ExpireAt)
	if exp == nil {
		badRequest(c, "到期时间必填")
		return
	}
	r := model.Reminder{
		Title: in.Title, Category: in.Category, ProjectID: in.ProjectID,
		Target: in.Target, ExpireAt: *exp, RemindDays: in.RemindDays,
		Issuer: in.Issuer, AutoRenew: in.AutoRenew, Note: in.Note, Enabled: true,
	}
	if r.Category == "" {
		r.Category = "other"
	}
	if in.RemindDays == 0 {
		r.RemindDays = 7
	}
	if in.Enabled != nil {
		r.Enabled = *in.Enabled
	}
	if err := h.DB.Create(&r).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) UpdateReminder(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Reminder
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "提醒不存在")
		return
	}
	var in reminderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	exp := mustParseDate(in.ExpireAt)
	updates := map[string]any{
		"title": in.Title, "category": in.Category, "project_id": in.ProjectID,
		"target": in.Target, "remind_days": in.RemindDays, "issuer": in.Issuer,
		"auto_renew": in.AutoRenew, "note": in.Note,
	}
	if exp != nil {
		updates["expire_at"] = exp
	}
	if in.Enabled != nil {
		updates["enabled"] = *in.Enabled
	}
	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(&cur, id)
	c.JSON(http.StatusOK, cur)
}

func (h *Handler) DeleteReminder(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.Delete(&model.Reminder{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

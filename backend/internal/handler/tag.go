package handler

import (
	"net/http"
	"strings"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

func (h *Handler) ListTags(c *gin.Context) {
	var items []model.Tag
	if err := h.DB.Order("name ASC").Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateTag(c *gin.Context) {
	var in model.Tag
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" {
		badRequest(c, "标签名必填")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	var exist model.Tag
	if err := h.DB.Where("name = ?", in.Name).First(&exist).Error; err == nil {
		c.JSON(http.StatusOK, exist)
		return
	}
	if in.Color == "" {
		in.Color = "#f97316"
	}
	if err := h.DB.Create(&in).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, in)
}

func (h *Handler) DeleteTag(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	h.DB.Where("tag_id = ?", id).Delete(&model.Taggable{})
	if err := h.DB.Delete(&model.Tag{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// 全局搜索：跨项目 / 任务 / 灵感 / 提醒 / 客户
func (h *Handler) Search(c *gin.Context) {
	s := strings.TrimSpace(c.Query("q"))
	if s == "" {
		c.JSON(http.StatusOK, gin.H{
			"projects": []any{}, "tasks": []any{}, "ideas": []any{},
			"reminders": []any{}, "clients": []any{},
		})
		return
	}
	like := "%" + s + "%"
	var projects []model.Project
	h.DB.Where("name LIKE ? OR summary LIKE ? OR tech_stack LIKE ?", like, like, like).Limit(8).Find(&projects)
	var tasks []model.Task
	h.DB.Where("title LIKE ? OR note LIKE ?", like, like).Limit(8).Find(&tasks)
	// 灵感记录：标题、正文、我的想法、标签都参与匹配
	var ideas []model.Idea
	h.DB.Where("title LIKE ? OR content LIKE ? OR note LIKE ? OR tags LIKE ?", like, like, like, like).
		Order("created_at DESC").Limit(6).Find(&ideas)
	var reminders []model.Reminder
	h.DB.Where("title LIKE ? OR target LIKE ?", like, like).Limit(8).Find(&reminders)
	var clients []model.Client
	h.DB.Where("name LIKE ? OR contact LIKE ?", like, like).Limit(8).Find(&clients)
	c.JSON(http.StatusOK, gin.H{
		"projects": projects, "tasks": tasks, "ideas": ideas,
		"reminders": reminders, "clients": clients,
	})
}

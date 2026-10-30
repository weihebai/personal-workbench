package handler

import (
	"math"
	"net/http"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

const billingHourly = "hourly"

// hourlyAmount 按分钟数 × 时薪算应结金额，保留到分。
func hourlyAmount(minutes int, rate float64) float64 {
	if minutes <= 0 || rate <= 0 {
		return 0
	}
	return math.Round((float64(minutes)/60*rate)*100) / 100
}

func (h *Handler) sumWorkMinutes(projectID uint) int {
	var row struct{ V int }
	h.DB.Model(&model.WorkLog{}).
		Select("COALESCE(SUM(minutes),0) as v").
		Where("project_id = ?", projectID).
		Scan(&row)
	return row.V
}

// syncHourlyQuote 按现有工时重算按工时计费项目的实际工时和合同额。
// 切换计费方式或改时薪后调用。
func (h *Handler) syncHourlyQuote(projectID uint) {
	var p model.Project
	if err := h.DB.First(&p, projectID).Error; err != nil {
		return
	}
	if p.BillingMode != billingHourly {
		return
	}
	total := h.sumWorkMinutes(projectID)
	h.DB.Model(&p).Updates(map[string]any{
		"actual_minutes": total,
		"quote":          hourlyAmount(total, p.HourlyRate),
	})
}

// syncWorkLogs 工时记录变化后回写项目实际工时；
// 按工时计费的项目同时重算合同额，保证收款进度和总览里的金额跟着工时走。
func (h *Handler) syncWorkLogs(projectID uint) {
	total := h.sumWorkMinutes(projectID)
	updates := map[string]any{"actual_minutes": total}
	var p model.Project
	if err := h.DB.First(&p, projectID).Error; err == nil && p.BillingMode == billingHourly {
		updates["quote"] = hourlyAmount(total, p.HourlyRate)
	}
	h.DB.Model(&model.Project{}).Where("id = ?", projectID).Updates(updates)
}

// GET /api/projects/:id/worklogs
func (h *Handler) ListWorkLogs(c *gin.Context) {
	projectID, ok := paramUint(c, "id")
	if !ok {
		return
	}
	items := []model.WorkLog{}
	if err := h.DB.Where("project_id = ?", projectID).
		Order("work_date DESC, id DESC").Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// POST /api/projects/:id/worklogs
func (h *Handler) CreateWorkLog(c *gin.Context) {
	projectID, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var project model.Project
	if err := h.DB.First(&project, projectID).Error; err != nil {
		notFound(c, "项目不存在")
		return
	}

	var in struct {
		WorkDate string `json:"workDate"`
		Minutes  int    `json:"minutes"`
		Content  string `json:"content"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	content := strings.TrimSpace(in.Content)
	if content == "" {
		badRequest(c, "工作内容必填")
		return
	}
	if in.Minutes <= 0 {
		badRequest(c, "工时必须大于 0")
		return
	}
	workDate := time.Now()
	if in.WorkDate != "" {
		d := mustParseDate(in.WorkDate)
		if d == nil {
			badRequest(c, "日期格式不正确")
			return
		}
		workDate = *d
	}

	log := model.WorkLog{
		ProjectID: projectID, WorkDate: workDate,
		Minutes: in.Minutes, Content: content,
	}
	if err := h.DB.Create(&log).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.syncWorkLogs(projectID)
	c.JSON(http.StatusCreated, log)
}

// PUT /api/worklogs/:id
func (h *Handler) UpdateWorkLog(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var log model.WorkLog
	if err := h.DB.First(&log, id).Error; err != nil {
		notFound(c, "工时记录不存在")
		return
	}

	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{}
	if v, ok := raw["workDate"]; ok {
		d := mustParseDate(toString(v))
		if d == nil {
			badRequest(c, "日期格式不正确")
			return
		}
		updates["work_date"] = d
	}
	if v, ok := raw["minutes"]; ok {
		f, isNum := toFloat(v)
		if !isNum || int(f) <= 0 {
			badRequest(c, "工时必须大于 0")
			return
		}
		updates["minutes"] = int(f)
	}
	if v, ok := raw["content"]; ok {
		content := strings.TrimSpace(toString(v))
		if content == "" {
			badRequest(c, "工作内容必填")
			return
		}
		updates["content"] = content
	}
	if len(updates) > 0 {
		if err := h.DB.Model(&log).Updates(updates).Error; err != nil {
			serverErr(c, err)
			return
		}
	}
	h.syncWorkLogs(log.ProjectID)
	h.DB.First(&log, id)
	c.JSON(http.StatusOK, log)
}

// DELETE /api/worklogs/:id
func (h *Handler) DeleteWorkLog(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var log model.WorkLog
	if err := h.DB.First(&log, id).Error; err != nil {
		notFound(c, "工时记录不存在")
		return
	}
	if err := h.DB.Delete(&log).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.syncWorkLogs(log.ProjectID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

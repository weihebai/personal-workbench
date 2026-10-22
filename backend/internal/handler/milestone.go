package handler

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

type milestoneView struct {
	model.Milestone
	State string `json:"state"` // normal 正常 / soon 临近 / overdue 已过期
}

func (h *Handler) ListMilestones(c *gin.Context) {
	q := h.DB.Model(&model.Milestone{})
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	// 只看未完成（用于待跟进）
	if c.Query("open") == "1" {
		q = q.Where("status IN ?", []string{"waiting", "delayed"})
	}
	var items []model.Milestone
	if err := q.Order("due_date IS NULL, due_date ASC, sort ASC").Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}

	// 补项目名
	ids := []uint{}
	for _, m := range items {
		ids = append(ids, m.ProjectID)
	}
	nameMap := map[uint]string{}
	if len(ids) > 0 {
		var ps []model.Project
		h.DB.Select("id, name").Where("id IN ?", ids).Find(&ps)
		for _, p := range ps {
			nameMap[p.ID] = p.Name
		}
	}

	views := make([]milestoneView, 0, len(items))
	for _, m := range items {
		m.ProjectName = nameMap[m.ProjectID]
		if m.DueDate != nil {
			dl := daysUntil(*m.DueDate)
			m.DaysLeft = &dl
		}
		views = append(views, milestoneView{Milestone: m, State: milestoneState(m)})
	}
	// 手动排序：未完成的按到期日优先，已完成沉底
	sort.SliceStable(views, func(i, j int) bool {
		return orderKey(views[i].Milestone) < orderKey(views[j].Milestone)
	})
	c.JSON(http.StatusOK, gin.H{"items": views})
}

func orderKey(m model.Milestone) int64 {
	finished := m.Status == "done" || m.Status == "canceled"
	var base int64 = 0
	if finished {
		base = 1 << 40
	}
	if m.DueDate == nil {
		return base + (1 << 30)
	}
	return base + m.DueDate.Unix()
}

// milestoneState 计算提醒状态（仅对未完成节点有意义）
func milestoneState(m model.Milestone) string {
	if m.Status == "done" || m.Status == "canceled" || m.DueDate == nil {
		return "normal"
	}
	dl := daysUntil(*m.DueDate)
	if dl < 0 {
		return "overdue"
	}
	if dl <= m.RemindDays {
		return "soon"
	}
	return "normal"
}

// PreviewMilestoneDue 供前端实时预览。保存时仍由 resolveDue 计算，
// 两边共用 computeDue，避免前端再维护一份工作日算法。
func (h *Handler) PreviewMilestoneDue(c *gin.Context) {
	start := mustParseDate(c.Query("start"))
	if start == nil {
		badRequest(c, "起始日格式应为 YYYY-MM-DD")
		return
	}
	days, err := strconv.Atoi(c.Query("days"))
	if err != nil || days <= 0 || days > 3650 {
		badRequest(c, "工期需在 1-3650 天之间")
		return
	}
	dayType := c.DefaultQuery("dayType", "workday")
	if dayType != "workday" && dayType != "natural" {
		badRequest(c, "计算方式只能是 workday 或 natural")
		return
	}
	due := computeDue(start, days, dayType)
	c.JSON(http.StatusOK, gin.H{"dueDate": due.Format("2006-01-02")})
}

type milestoneInput struct {
	ProjectID  uint   `json:"projectId"`
	Title      string `json:"title"`
	Expect     string `json:"expect"`
	Status     string `json:"status"`
	StartDate  string `json:"startDate"`
	DayType    string `json:"dayType"`
	Days       int    `json:"days"`
	DueDate    string `json:"dueDate"`
	RemindDays int    `json:"remindDays"`
	Sort       int    `json:"sort"`
	Note       string `json:"note"`
}

// resolveDue 统一处理：优先手工指定的 dueDate，其次按 startDate + days 推算
func (in milestoneInput) resolveDue() (*time.Time, error) {
	start := mustParseDate(in.StartDate)
	if in.DueDate != "" {
		due := mustParseDate(in.DueDate)
		if due == nil {
			return nil, errInvalidDate
		}
		return due, nil
	}
	if start != nil && in.Days > 0 {
		return computeDue(start, in.Days, in.DayType), nil
	}
	return nil, nil
}

var errInvalidDate = &dateErr{}

type dateErr struct{}

func (*dateErr) Error() string { return "日期格式无效" }

func (h *Handler) CreateMilestone(c *gin.Context) {
	var in milestoneInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if in.ProjectID == 0 {
		badRequest(c, "必须指定项目")
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		badRequest(c, "节点名称必填")
		return
	}
	var cnt int64
	h.DB.Model(&model.Project{}).Where("id = ?", in.ProjectID).Count(&cnt)
	if cnt == 0 {
		badRequest(c, "项目不存在")
		return
	}
	due, err := in.resolveDue()
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	m := model.Milestone{
		ProjectID: in.ProjectID,
		Title:     in.Title,
		Expect:    in.Expect,
		Status:    in.Status,
		StartDate: mustParseDate(in.StartDate),
		DayType:   in.DayType,
		Days:      in.Days,
		DueDate:   due,
		RemindDays: in.RemindDays,
		Sort:       in.Sort,
		Note:       in.Note,
	}
	if m.Status == "" {
		m.Status = "waiting"
	}
	if m.DayType == "" {
		m.DayType = "workday"
	}
	if in.RemindDays == 0 {
		m.RemindDays = 3
	}
	if m.Status == "done" {
		now := time.Now()
		m.DoneAt = &now
	}
	if err := h.DB.Create(&m).Error; err != nil {
		serverErr(c, err)
		return
	}
	var p model.Project
	if err := h.DB.Select("id, name").First(&p, m.ProjectID).Error; err == nil {
		m.ProjectName = p.Name
	}
	c.JSON(http.StatusCreated, m)
}

func (h *Handler) UpdateMilestone(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Milestone
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "节点不存在")
		return
	}
	var in milestoneInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}

	updates := map[string]any{
		"title": in.Title, "expect": in.Expect, "status": in.Status,
		"start_date": mustParseDate(in.StartDate), "day_type": in.DayType,
		"days": in.Days, "remind_days": in.RemindDays, "sort": in.Sort, "note": in.Note,
	}
	due, err := in.resolveDue()
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	updates["due_date"] = due

	if in.Status == "done" {
		if cur.DoneAt == nil {
			now := time.Now()
			updates["done_at"] = &now
		}
	} else {
		updates["done_at"] = nil
	}

	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(&cur, id)
	if cur.DueDate != nil {
		dl := daysUntil(*cur.DueDate)
		cur.DaysLeft = &dl
	}
	c.JSON(http.StatusOK, cur)
}

func (h *Handler) DeleteMilestone(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.Delete(&model.Milestone{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// QuickStatus 快捷切换状态（时间线上直接点）
func (h *Handler) QuickMilestoneStatus(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Milestone
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "节点不存在")
		return
	}
	var in struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{"status": in.Status}
	if in.Status == "done" {
		now := time.Now()
		updates["done_at"] = &now
	} else {
		updates["done_at"] = nil
	}
	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(&cur, id)
	c.JSON(http.StatusOK, cur)
}

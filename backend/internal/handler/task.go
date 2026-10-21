package handler

import (
	"net/http"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

// 截止状态：normal 正常 / soon 临近 / overdue 已逾期
func dueState(t *time.Time, remindDays int) string {
	if t == nil {
		return ""
	}
	now := time.Now()
	// 以日为单位比较
	due := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, t.Location())
	if now.After(due) {
		return "overdue"
	}
	if t.AddDate(0, 0, remindDays).Before(now) {
		return "soon"
	}
	return "normal"
}

type taskView struct {
	model.Task
	DueState  string `json:"dueState"`
	ProjectName string `json:"projectName"`
	ClientName  string `json:"clientName"`
}

func (h *Handler) ListTasks(c *gin.Context) {
	page, size := paginate(c)
	q := h.DB.Model(&model.Task{})
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		like := "%" + s + "%"
		q = q.Where("title LIKE ? OR desc LIKE ? OR note LIKE ?", like, like, like)
	}
	for _, k := range []string{"status", "priority", "kind"} {
		if v := c.Query(k); v != "" {
			q = q.Where(k+" = ?", v)
		}
	}
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}
	if c.Query("overdue") == "1" {
		q = q.Where("due_date IS NOT NULL AND due_date < ? AND status NOT IN ?", time.Now(), []string{"done", "canceled"})
	}

	var total int64
	q.Count(&total)
	var items []model.Task
	order := "created_at DESC"
	if c.Query("sort") == "due" {
		order = "due_date IS NULL, due_date ASC"
	}
	if err := q.Order(order).Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}

	// 关联项目名 / 客户名
	projIDs := []uint{}
	for _, t := range items {
		if t.ProjectID != nil {
			projIDs = append(projIDs, *t.ProjectID)
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
	cliIDs := []uint{}
	for _, t := range items {
		if t.ClientID != nil {
			cliIDs = append(cliIDs, *t.ClientID)
		}
	}
	cliName := map[uint]string{}
	if len(cliIDs) > 0 {
		var cs []model.Client
		h.DB.Select("id, name").Where("id IN ?", cliIDs).Find(&cs)
		for _, cl := range cs {
			cliName[cl.ID] = cl.Name
		}
	}

	views := make([]taskView, 0, len(items))
	for _, t := range items {
		v := taskView{Task: t, DueState: dueState(t.DueDate, t.RemindDays)}
		if t.ProjectID != nil {
			v.ProjectName = projName[*t.ProjectID]
		}
		if t.ClientID != nil {
			v.ClientName = cliName[*t.ClientID]
		}
		views = append(views, v)
	}
	// 子任务进度（2/4 那种徽标），列表只回填计数不回填清单
	flat := make([]model.Task, len(views))
	for i := range views {
		flat[i] = views[i].Task
	}
	h.fillSubtaskProgress(flat)
	for i := range views {
		views[i].SubtaskTotal = flat[i].SubtaskTotal
		views[i].SubtaskDone = flat[i].SubtaskDone
	}
	c.JSON(http.StatusOK, paginated(views, total, page, size))
}

type taskInput struct {
	Title           string  `json:"title"`
	Desc            string  `json:"desc"`
	ProjectID       *uint   `json:"projectId"`
	ClientID        *uint   `json:"clientId"`
	Status          string  `json:"status"`
	Priority        string  `json:"priority"`
	Kind            string  `json:"kind"`
	DueDate         string  `json:"dueDate"`
	RemindDays      int     `json:"remindDays"`
	EstimateMinutes int     `json:"estimateMinutes"`
	ActualMinutes   int     `json:"actualMinutes"`
	Budget          float64 `json:"budget"`
	Note            string  `json:"note"`
}

func (h *Handler) CreateTask(c *gin.Context) {
	var in taskInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		badRequest(c, "任务标题必填")
		return
	}
	t := model.Task{
		Title: in.Title, Desc: in.Desc, ProjectID: in.ProjectID, ClientID: in.ClientID,
		Status: in.Status, Priority: in.Priority, Kind: in.Kind,
		DueDate: mustParseDate(in.DueDate), RemindDays: in.RemindDays,
		EstimateMinutes: in.EstimateMinutes, ActualMinutes: in.ActualMinutes,
		Budget: in.Budget, Note: in.Note,
	}
	if t.Status == "" {
		t.Status = "todo"
	}
	if t.Priority == "" {
		t.Priority = "normal"
	}
	if t.Kind == "" {
		t.Kind = "freelance"
	}
	if err := h.DB.Create(&t).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, t)
}

func (h *Handler) UpdateTask(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Task
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "任务不存在")
		return
	}

	// 支持部分字段更新（用于看板拖拽、勾选完成）
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{}
	strFields := map[string]string{"title": "title", "desc": "desc", "status": "status", "priority": "priority", "kind": "kind", "note": "note"}
	for js, col := range strFields {
		if v, ok := raw[js]; ok {
			updates[col] = v
		}
	}
	if v, ok := raw["projectId"]; ok {
		updates["project_id"] = v
	}
	if v, ok := raw["clientId"]; ok {
		updates["client_id"] = v
	}
	if v, ok := raw["dueDate"]; ok {
		s, _ := v.(string)
		updates["due_date"] = mustParseDate(s)
	}
	for _, f := range []string{"remindDays", "estimateMinutes", "actualMinutes", "budget"} {
		if v, ok := raw[f]; ok {
			updates[colName(f)] = v
		}
	}
	// 完成时记录完成时间
	if s, ok := updates["status"].(string); ok {
		if s == "done" {
			now := time.Now()
			updates["done_at"] = &now
		} else if cur.Status == "done" {
			updates["done_at"] = nil
		}
	}
	if len(updates) > 0 {
		if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
			serverErr(c, err)
			return
		}
	}
	h.DB.First(&cur, id)
	c.JSON(http.StatusOK, cur)
}

func colName(camel string) string {
	switch camel {
	case "remindDays":
		return "remind_days"
	case "estimateMinutes":
		return "estimate_minutes"
	case "actualMinutes":
		return "actual_minutes"
	case "budget":
		return "budget"
	}
	return camel
}

func (h *Handler) DeleteTask(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	// 子任务是任务的附属数据，任务删了它们就没有归属了，一起清掉
	h.DB.Where("task_id = ?", id).Delete(&model.Subtask{})
	if err := h.DB.Delete(&model.Task{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

package handler

import (
	"net/http"
	"strings"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

// 子任务：任务内部的步骤清单。
//
// 设计取舍：为什么不直接把步骤拆成独立任务？
// 「上传代码 / 域名访问 / 完善信息 / 测试支付」这四步属于同一个交付动作，
// 拆成四个任务会丢掉「它们是一件事」的语义，看板上也会显得很碎。
// 所以做成任务内的勾选清单，卡片上只显示 2/4 这样的进度。

const subtaskTitleMax = 255

// 回填一批任务的子任务进度。
//
// withItems=false 时只算 done/total 两个数字：看板默认只要徽标，
// 没必要把每张卡的完整清单都传一遍。
// withItems=true 时连清单一起回填：卡片上要能直接展开勾选，
// 一张卡一个请求的话十几张卡就是十几个并发，不如一次带回来。
func (h *Handler) fillSubtaskProgress(tasks []model.Task, withItems bool) {
	if len(tasks) == 0 {
		return
	}
	ids := make([]uint, 0, len(tasks))
	for _, t := range tasks {
		ids = append(ids, t.ID)
	}

	if withItems {
		var all []model.Subtask
		h.DB.Where("task_id IN ?", ids).Order("sort ASC, id ASC").Find(&all)
		byTask := make(map[uint][]model.Subtask, len(ids))
		for _, s := range all {
			byTask[s.TaskID] = append(byTask[s.TaskID], s)
		}
		for i := range tasks {
			list := byTask[tasks[i].ID]
			tasks[i].Subtasks = list
			tasks[i].SubtaskTotal = len(list)
			tasks[i].SubtaskDone = 0
			for _, s := range list {
				if s.Done {
					tasks[i].SubtaskDone++
				}
			}
		}
		return
	}

	var rows []struct {
		TaskID uint
		Total  int
		Done   int
	}
	h.DB.Model(&model.Subtask{}).
		Select("task_id, COUNT(*) as total, SUM(CASE WHEN done THEN 1 ELSE 0 END) as done").
		Where("task_id IN ?", ids).
		Group("task_id").
		Scan(&rows)

	byTask := make(map[uint]struct{ total, done int }, len(rows))
	for _, r := range rows {
		byTask[r.TaskID] = struct{ total, done int }{r.Total, r.Done}
	}
	for i := range tasks {
		if v, ok := byTask[tasks[i].ID]; ok {
			tasks[i].SubtaskTotal = v.total
			tasks[i].SubtaskDone = v.done
		}
	}
}

// 回填单个任务的完整子任务清单（详情用）
func (h *Handler) loadSubtasks(t *model.Task) {
	var list []model.Subtask
	h.DB.Where("task_id = ?", t.ID).Order("sort ASC, id ASC").Find(&list)
	t.Subtasks = list
	t.SubtaskTotal = len(list)
	t.SubtaskDone = 0
	for _, s := range list {
		if s.Done {
			t.SubtaskDone++
		}
	}
}

// GET /api/tasks/:id/subtasks
func (h *Handler) ListSubtasks(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var list []model.Subtask
	if err := h.DB.Where("task_id = ?", id).Order("sort ASC, id ASC").Find(&list).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": list})
}

// POST /api/tasks/:id/subtasks
func (h *Handler) CreateSubtask(c *gin.Context) {
	taskID, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var task model.Task
	if err := h.DB.First(&task, taskID).Error; err != nil {
		notFound(c, "任务不存在")
		return
	}

	var in struct {
		Title string `json:"title"`
		Sort  int    `json:"sort"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		badRequest(c, "步骤内容不能为空")
		return
	}
	if len([]rune(title)) > subtaskTitleMax {
		title = string([]rune(title)[:subtaskTitleMax])
	}

	// 没指定顺序就追加到末尾
	sort := in.Sort
	if sort == 0 {
		var maxSort struct{ V int }
		h.DB.Model(&model.Subtask{}).Select("COALESCE(MAX(sort),0) as v").Where("task_id = ?", taskID).Scan(&maxSort)
		sort = maxSort.V + 10
	}

	st := model.Subtask{TaskID: taskID, Title: title, Sort: sort}
	if err := h.DB.Create(&st).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

// PUT /api/subtasks/:id
func (h *Handler) UpdateSubtask(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var st model.Subtask
	if err := h.DB.First(&st, id).Error; err != nil {
		notFound(c, "步骤不存在")
		return
	}

	// 局部更新：勾选只传 done，改名只传 title
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{}
	if v, ok := raw["title"]; ok {
		title := strings.TrimSpace(toString(v))
		if title == "" {
			badRequest(c, "步骤内容不能为空")
			return
		}
		if len([]rune(title)) > subtaskTitleMax {
			title = string([]rune(title)[:subtaskTitleMax])
		}
		updates["title"] = title
	}
	if v, ok := raw["done"]; ok {
		if b, isBool := v.(bool); isBool {
			updates["done"] = b
		}
	}
	if v, ok := raw["sort"]; ok {
		if f, isNum := toFloat(v); isNum {
			updates["sort"] = int(f)
		}
	}
	if len(updates) > 0 {
		if err := h.DB.Model(&st).Updates(updates).Error; err != nil {
			serverErr(c, err)
			return
		}
	}
	h.DB.First(&st, id)
	c.JSON(http.StatusOK, st)
}

// DELETE /api/subtasks/:id
func (h *Handler) DeleteSubtask(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.Delete(&model.Subtask{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /api/tasks/:id/subtasks/bulk
//
// 一次性把一段多行文本变成步骤。「上传代码\n域名访问\n完善信息」直接粘贴即可，
// 这是录入这类「一条任务多个步骤」最快的方式，省得一条条敲。
func (h *Handler) BulkCreateSubtasks(c *gin.Context) {
	taskID, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var task model.Task
	if err := h.DB.First(&task, taskID).Error; err != nil {
		notFound(c, "任务不存在")
		return
	}

	var in struct {
		Text string `json:"text"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}

	var maxSort struct{ V int }
	h.DB.Model(&model.Subtask{}).Select("COALESCE(MAX(sort),0) as v").Where("task_id = ?", taskID).Scan(&maxSort)
	sort := maxSort.V

	created := []model.Subtask{}
	// 逐行拆，同时容忍用 1. 2. 、 、 - 开头的列表格式
	for _, line := range strings.Split(in.Text, "\n") {
		title := strings.TrimSpace(line)
		title = trimListMarker(title)
		if title == "" {
			continue
		}
		if len([]rune(title)) > subtaskTitleMax {
			title = string([]rune(title)[:subtaskTitleMax])
		}
		sort += 10
		st := model.Subtask{TaskID: taskID, Title: title, Sort: sort}
		if err := h.DB.Create(&st).Error; err != nil {
			serverErr(c, err)
			return
		}
		created = append(created, st)
	}
	c.JSON(http.StatusOK, gin.H{"items": created, "count": len(created)})
}

// 去掉行首的列表符号：1. / 1、/ - / * / ✓ 等
func trimListMarker(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	r := []rune(s)
	i := 0
	for i < len(r) && r[i] >= '0' && r[i] <= '9' {
		i++
	}
	if i > 0 && i < len(r) {
		switch r[i] {
		case '.', '、', ')', '．':
			rest := strings.TrimSpace(string(r[i+1:]))
			if rest != "" {
				return rest
			}
		}
	}
	for _, p := range []string{"- ", "* ", "• ", "✓ ", "· "} {
		if strings.HasPrefix(s, p) {
			return strings.TrimSpace(s[len(p):])
		}
	}
	return s
}

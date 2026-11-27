package handler

import (
	"net/http"
	"sort"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

// 每周回顾：GTD 的复查入口，只读聚合，不改任何任务。
// 按 Bucket 分组，不看 Status 的执行进度，与看板、执行生命周期互不影响。
type reviewTask struct {
	ID          uint       `json:"id"`
	No          string     `json:"no"`
	Title       string     `json:"title"`
	Bucket      string     `json:"bucket"`
	Status      string     `json:"status"`
	Context     string     `json:"context"`
	WaitingFor  string     `json:"waitingFor"`
	FollowUpAt  *time.Time `json:"followUpAt"`
	DueDate     *time.Time `json:"dueDate"`
	ProjectID   *uint      `json:"projectId"`
	ProjectName string     `json:"projectName"`
}

type reviewProject struct {
	ID     uint   `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
}

func (h *Handler) Review(c *gin.Context) {
	var tasks []model.Task
	if err := h.DB.Where("status NOT IN ?", []string{"done", "canceled", "archived"}).
		Order("due_date IS NULL, due_date ASC, created_at DESC").Find(&tasks).Error; err != nil {
		serverErr(c, err)
		return
	}

	projName := map[uint]string{}
	ids := make([]uint, 0, len(tasks))
	for _, t := range tasks {
		if t.ProjectID != nil {
			ids = append(ids, *t.ProjectID)
		}
	}
	if len(ids) > 0 {
		var ps []model.Project
		h.DB.Select("id, name").Where("id IN ?", ids).Find(&ps)
		for _, p := range ps {
			projName[p.ID] = p.Name
		}
	}

	buckets := map[string][]reviewTask{}
	overdue := make([]reviewTask, 0)
	now := time.Now()
	for _, t := range tasks {
		bucket := t.Bucket
		if bucket == "" {
			bucket = "next"
		}
		v := reviewTask{
			ID: t.ID, No: taskNo(t.ID), Title: t.Title, Bucket: bucket, Status: t.Status,
			Context: t.Context, WaitingFor: t.WaitingFor, FollowUpAt: t.FollowUpAt,
			DueDate: t.DueDate, ProjectID: t.ProjectID,
		}
		if t.ProjectID != nil {
			v.ProjectName = projName[*t.ProjectID]
		}
		buckets[bucket] = append(buckets[bucket], v)
		// 逾期只看真正还开着的执行中/待办，归档与取消不提醒
		if t.DueDate != nil && t.DueDate.Before(now) && (t.Status == "todo" || t.Status == "doing") {
			overdue = append(overdue, v)
		}
	}

	counts := gin.H{}
	out := gin.H{}
	for _, b := range []string{"inbox", "next", "waiting", "someday"} {
		counts[b] = len(buckets[b])
		out[b] = limitReview(buckets[b], 50)
	}
	counts["overdue"] = len(overdue)
	out["overdue"] = limitReview(overdue, 50)

	// 有未完成任务的项目不缺「下一步行动」，这里只列完全空转的活跃项目
	var projects []model.Project
	h.DB.Select("id, name, kind, status").Where("status = ?", "active").Find(&projects)
	running := map[uint]bool{}
	for _, t := range tasks {
		if t.ProjectID != nil && (t.Status == "todo" || t.Status == "doing") {
			running[*t.ProjectID] = true
		}
	}
	noNext := make([]reviewProject, 0)
	for _, p := range projects {
		if !running[p.ID] {
			noNext = append(noNext, reviewProject{ID: p.ID, Name: p.Name, Kind: p.Kind, Status: p.Status})
		}
	}
	sort.Slice(noNext, func(i, j int) bool { return noNext[i].Name < noNext[j].Name })
	counts["noNextProjects"] = len(noNext)
	out["noNextProjects"] = noNext
	out["counts"] = counts

	c.JSON(http.StatusOK, out)
}

// 回顾页只展示前若干条，避免把几百条历史一次带回前端。
func limitReview(items []reviewTask, n int) []reviewTask {
	if len(items) > n {
		return items[:n]
	}
	if items == nil {
		return []reviewTask{}
	}
	return items
}

package handler

import (
	"net/http"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

type monthStat struct {
	Month    string  `json:"month"`
	Quote    float64 `json:"quote"`
	Received float64 `json:"received"`
}

type kindStat struct {
	Kind     string  `json:"kind"`
	Count    int64   `json:"count"`
	Quote    float64 `json:"quote"`
	Received float64 `json:"received"`
}

// Dashboard 总览：收入、项目、任务、到期提醒汇总
func (h *Handler) Dashboard(c *gin.Context) {
	var (
		projTotal    int64
		projActive   int64
		projUnpaid   int64
		taskTodo     int64
		taskDoing    int64
		taskOverdue  int64
		remindSoon   int64
		remindExpired int64
	)

	h.DB.Model(&model.Project{}).Count(&projTotal)
	h.DB.Model(&model.Project{}).Where("status IN ?", []string{"active", "negotiating"}).Count(&projActive)
	h.DB.Model(&model.Project{}).Where("status IN ?", []string{"active", "delivered", "negotiating"}).Count(&projUnpaid)

	h.DB.Model(&model.Task{}).Where("status = ?", "todo").Count(&taskTodo)
	h.DB.Model(&model.Task{}).Where("status = ?", "doing").Count(&taskDoing)
	h.DB.Model(&model.Task{}).
		Where("due_date IS NOT NULL AND due_date < ? AND status NOT IN ?", time.Now(), []string{"done", "canceled"}).
		Count(&taskOverdue)

	now := time.Now()
	var reminders []model.Reminder
	h.DB.Where("enabled = ?", true).Find(&reminders)
	for _, r := range reminders {
		if now.After(r.ExpireAt) {
			remindExpired++
		} else if now.AddDate(0, 0, r.RemindDays).After(r.ExpireAt) {
			remindSoon++
		}
	}

	// 财务（分别查询，避免 GORM Scan 覆盖同结构体字段）
	var fin struct {
		Quote    float64
		Cost     float64
		Received float64
		Pending  float64
	}
	var projFin struct {
		Quote float64
		Cost  float64
	}
	h.DB.Model(&model.Project{}).
		Select("COALESCE(SUM(quote),0) as quote, COALESCE(SUM(cost),0) as cost").
		Scan(&projFin)
	fin.Quote, fin.Cost = projFin.Quote, projFin.Cost

	var payFin struct {
		Received float64
		Pending  float64
	}
	h.DB.Model(&model.Payment{}).
		Select(`COALESCE(SUM(CASE WHEN status = 'received' THEN amount ELSE 0 END),0) as received,
		        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END),0) as pending`).
		Scan(&payFin)
	fin.Received, fin.Pending = payFin.Received, payFin.Pending

	// 近 6 个月收款趋势
	months := []monthStat{}
	for i := 5; i >= 0; i-- {
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).AddDate(0, -i, 0)
		end := start.AddDate(0, 1, 0)
		var sum struct{ V float64 }
		h.DB.Model(&model.Payment{}).
			Select("COALESCE(SUM(amount),0) as v").
			Where("status = ? AND paid_date >= ? AND paid_date < ?", "received", start, end).
			Scan(&sum)
		var projSum struct{ V float64 }
		h.DB.Model(&model.Project{}).
			Select("COALESCE(SUM(quote),0) as v").
			Where("start_date >= ? AND start_date < ?", start, end).
			Scan(&projSum)
		months = append(months, monthStat{Month: start.Format("2006-01"), Quote: projSum.V, Received: sum.V})
	}

	// 按项目类型统计
	kindStats := []kindStat{}
	h.DB.Model(&model.Project{}).
		Select("kind, COUNT(*) as count, COALESCE(SUM(quote),0) as quote").
		Group("kind").Scan(&kindStats)
	for i := range kindStats {
		var rec struct{ V float64 }
		h.DB.Model(&model.Payment{}).
			Select("COALESCE(SUM(payments.amount),0) as v").
			Joins("JOIN projects ON projects.id = payments.project_id").
			Where("projects.kind = ? AND payments.status = ?", kindStats[i].Kind, "received").
			Scan(&rec)
		kindStats[i].Received = rec.V
	}

	// 待处理清单：逾期任务 + 待收款项 + 临期提醒
	var overdueTasks []model.Task
	h.DB.Where("due_date IS NOT NULL AND due_date < ? AND status NOT IN ?", time.Now(), []string{"done", "canceled"}).
		Order("due_date ASC").Limit(10).Find(&overdueTasks)

	var pendingPayments []model.Payment
	h.DB.Where("status = ?", "pending").Order("plan_date ASC").Limit(10).Find(&pendingPayments)

	var soonReminders []model.Reminder
	h.DB.Where("enabled = ? AND expire_at <= ?", true, now.AddDate(0, 0, 30)).
		Order("expire_at ASC").Limit(10).Find(&soonReminders)

	// 待跟进里程碑：临期或已过期的未完成节点
	var openMs []model.Milestone
	h.DB.Where("status IN ? AND due_date IS NOT NULL", []string{"waiting", "delayed"}).
		Order("due_date ASC").Find(&openMs)
	msIDs := []uint{}
	for _, m := range openMs {
		msIDs = append(msIDs, m.ProjectID)
	}
	msProjName := map[uint]string{}
	if len(msIDs) > 0 {
		var ps []model.Project
		h.DB.Select("id, name").Where("id IN ?", msIDs).Find(&ps)
		for _, p := range ps {
			msProjName[p.ID] = p.Name
		}
	}
	var followUps []gin.H
	followCount := 0
	for i := range openMs {
		dl := daysUntil(*openMs[i].DueDate)
		if dl <= openMs[i].RemindDays {
			followCount++
			if len(followUps) < 10 {
				followUps = append(followUps, gin.H{
					"id":          openMs[i].ID,
					"title":       openMs[i].Title,
					"expect":      openMs[i].Expect,
					"projectId":   openMs[i].ProjectID,
					"projectName": msProjName[openMs[i].ProjectID],
					"dueDate":     openMs[i].DueDate,
					"daysLeft":    dl,
					"status":      openMs[i].Status,
					"remindDays":  openMs[i].RemindDays,
				})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"counts": gin.H{
			"projects": projTotal, "activeProjects": projActive, "unpaidProjects": projUnpaid,
			"todoTasks": taskTodo, "doingTasks": taskDoing, "overdueTasks": taskOverdue,
			"remindersSoon": remindSoon, "remindersExpired": remindExpired,
			"followUps": followCount,
		},
		"finance": gin.H{
			"quote": fin.Quote, "cost": fin.Cost, "received": fin.Received,
			"pending": fin.Pending, "profit": fin.Received - fin.Cost,
			"unreceived": fin.Quote - fin.Received,
		},
		"monthly":         months,
		"byKind":          kindStats,
		"overdueTasks":    overdueTasks,
		"pendingPayments": pendingPayments,
		"soonReminders":   soonReminders,
		"followUps":       followUps,
	})
}

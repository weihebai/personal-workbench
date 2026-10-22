package handler

import (
	"net/http"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---------- 客户 ----------

func (h *Handler) ListClients(c *gin.Context) {
	q := h.DB.Model(&model.Client{})
	if s := c.Query("q"); s != "" {
		like := "%" + s + "%"
		q = q.Where("name LIKE ? OR contact LIKE ? OR phone LIKE ?", like, like, like)
	}
	var items []model.Client
	if err := q.Order("created_at DESC").Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateClient(c *gin.Context) {
	var in model.Client
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		badRequest(c, "客户名称必填")
		return
	}
	if err := h.DB.Create(&in).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, in)
}

func (h *Handler) UpdateClient(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Client
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "客户不存在")
		return
	}
	var in model.Client
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	in.ID = cur.ID
	in.CreatedAt = cur.CreatedAt
	if err := h.DB.Model(&cur).Select("name", "contact", "phone", "wechat", "source", "note").Updates(&in).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, in)
}

func (h *Handler) DeleteClient(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.Delete(&model.Client{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---------- 项目 ----------

type projectInput struct {
	Name            string  `json:"name"`
	Kind            string  `json:"kind"`
	Status          string  `json:"status"`
	Summary         string  `json:"summary"`
	SourcePath      string  `json:"sourcePath"`
	OnlineURL       string  `json:"onlineUrl"`
	AdminURL        string  `json:"adminUrl"`
	GitRepo         string  `json:"gitRepo"`
	DeployAt        string  `json:"deployAt"`
	TechStack       string  `json:"techStack"`
	ClientID        *uint   `json:"clientId"`
	Quote           float64 `json:"quote"`
	Cost            float64 `json:"cost"`
	CommissionType  string  `json:"commissionType"`
	CommissionRate  float64 `json:"commissionRate"`
	Broker          string  `json:"broker"`
	StartDate       string  `json:"startDate"`
	DueDate         string  `json:"dueDate"`
	EstimateMinutes int     `json:"estimateMinutes"`
	ActualMinutes   int     `json:"actualMinutes"`
	Note            string  `json:"note"`
	Tags            []string `json:"tags"`
}

func (in projectInput) toModel() model.Project {
	return model.Project{
		Name: in.Name, Kind: in.Kind, Status: in.Status, Summary: in.Summary,
		SourcePath: in.SourcePath, OnlineURL: in.OnlineURL, AdminURL: in.AdminURL,
		GitRepo: in.GitRepo, DeployAt: in.DeployAt, TechStack: in.TechStack,
		ClientID: in.ClientID, Quote: in.Quote, Cost: in.Cost,
		CommissionType: in.CommissionType, CommissionRate: in.CommissionRate, Broker: in.Broker,
		StartDate: mustParseDate(in.StartDate), DueDate: mustParseDate(in.DueDate),
		EstimateMinutes: in.EstimateMinutes, ActualMinutes: in.ActualMinutes,
		Note: in.Note,
	}
}

// commissionOf 按项目配置计算抽成金额。
// 抽成不会超过合同额，避免手滑填 200% 导致净收入为负。
func commissionOf(p *model.Project) float64 {
	if p.Quote <= 0 || p.CommissionRate <= 0 {
		return 0
	}
	var c float64
	switch p.CommissionType {
	case "pct":
		c = p.Quote * p.CommissionRate / 100
	case "fixed":
		c = p.CommissionRate
	default:
		return 0
	}
	if c < 0 {
		c = 0
	}
	if c > p.Quote {
		c = p.Quote
	}
	return c
}

// sumCommission 汇总抽成。必须逐项目套用 commissionOf 后再相加：
// 若先把所有合同额汇总再统一封顶，固定抽成高于自身合同额的项目会算多，
// 导致总览的抽成与项目页逐个相加的结果对不上。
func sumCommission(items []model.Project) float64 {
	var sum float64
	for i := range items {
		sum += commissionOf(&items[i])
	}
	return sum
}

// fillCommission 填充抽成与净收入（只读字段）
func fillCommission(items []model.Project) {
	for i := range items {
		c := commissionOf(&items[i])
		items[i].Commission = c
		items[i].NetQuote = items[i].Quote - c
	}
}

func (h *Handler) ListProjects(c *gin.Context) {
	page, size := paginate(c)
	q := h.DB.Model(&model.Project{})
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		like := "%" + s + "%"
		q = q.Where("name LIKE ? OR summary LIKE ? OR tech_stack LIKE ? OR online_url LIKE ?", like, like, like, like)
	}
	if s := c.Query("kind"); s != "" {
		q = q.Where("kind = ?", s)
	}
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	if s := c.Query("clientId"); s != "" {
		if id := queryUint(c, "clientId"); id != nil {
			q = q.Where("client_id = ?", *id)
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		serverErr(c, err)
		return
	}
	var items []model.Project
	if err := q.Order("updated_at DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.fillProjectStats(items)
	fillCommission(items)
	c.JSON(http.StatusOK, paginated(items, total, page, size))
}

// fillProjectStats 批量填充已收金额与标签
func (h *Handler) fillProjectStats(items []model.Project) {
	if len(items) == 0 {
		return
	}
	ids := make([]uint, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}

	type recRow struct {
		ProjectID uint
		Amount    float64
	}
	var rows []recRow
	h.DB.Model(&model.Payment{}).
		Select("project_id, SUM(amount) as amount").
		Where("project_id IN ? AND status = ?", ids, "received").
		Group("project_id").Scan(&rows)
	recMap := map[uint]float64{}
	for _, r := range rows {
		recMap[r.ProjectID] = r.Amount
	}

	var taggables []model.Taggable
	h.DB.Where("target = ? AND target_id IN ?", "project", ids).Find(&taggables)
	tagIDs := []uint{}
	for _, t := range taggables {
		tagIDs = append(tagIDs, t.TagID)
	}
	tagMap := map[uint]string{}
	if len(tagIDs) > 0 {
		var tags []model.Tag
		h.DB.Where("id IN ?", tagIDs).Find(&tags)
		for _, t := range tags {
			tagMap[t.ID] = t.Name
		}
	}
	tagsByProject := map[uint][]string{}
	for _, t := range taggables {
		if name, ok := tagMap[t.TagID]; ok {
			tagsByProject[t.TargetID] = append(tagsByProject[t.TargetID], name)
		}
	}

	for i := range items {
		items[i].Received = recMap[items[i].ID]
		items[i].TagList = tagsByProject[items[i].ID]
		if items[i].TagList == nil {
			items[i].TagList = []string{}
		}
	}

	// 里程碑进度统计
	var ms []model.Milestone
	h.DB.Where("project_id IN ?", ids).Find(&ms)
	type msAgg struct {
		total, done int
		next        *model.Milestone
	}
	agg := map[uint]*msAgg{}
	for i := range ms {
		a := agg[ms[i].ProjectID]
		if a == nil {
			a = &msAgg{}
			agg[ms[i].ProjectID] = a
		}
		if ms[i].Status != "canceled" {
			a.total++
			if ms[i].Status == "done" {
				a.done++
			}
		}
		if (ms[i].Status == "waiting" || ms[i].Status == "delayed") && ms[i].DueDate != nil {
			if a.next == nil || ms[i].DueDate.Before(*a.next.DueDate) {
				a.next = &ms[i]
			}
		}
	}
	for i := range items {
		if a := agg[items[i].ID]; a != nil {
			items[i].MilestoneTotal = a.total
			items[i].MilestoneDone = a.done
			if a.next != nil {
				items[i].NextMilestone = a.next.Title
				dl := daysUntil(*a.next.DueDate)
				items[i].NextDueIn = &dl
			}
		}
	}
}

func (h *Handler) GetProject(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var p model.Project
	if err := h.DB.First(&p, id).Error; err != nil {
		notFound(c, "项目不存在")
		return
	}
	list := []model.Project{p}
	h.fillProjectStats(list)
	fillCommission(list)
	p = list[0]

	var payments []model.Payment
	h.DB.Where("project_id = ?", id).Order("plan_date ASC").Find(&payments)
	decoratePayments(payments)
	var tasks []model.Task
	h.DB.Where("project_id = ?", id).Order("created_at DESC").Limit(50).Find(&tasks)
	var client *model.Client
	if p.ClientID != nil {
		var cl model.Client
		if err := h.DB.First(&cl, *p.ClientID).Error; err == nil {
			client = &cl
		}
	}
	var reminders []model.Reminder
	h.DB.Where("project_id = ?", id).Order("expire_at ASC").Find(&reminders)

	var milestones []model.Milestone
	h.DB.Where("project_id = ?", id).Order("due_date IS NULL, due_date ASC, sort ASC").Find(&milestones)
	msViews := make([]milestoneView, 0, len(milestones))
	for _, m := range milestones {
		if m.DueDate != nil {
			dl := daysUntil(*m.DueDate)
			m.DaysLeft = &dl
		}
		msViews = append(msViews, milestoneView{Milestone: m, State: milestoneState(m)})
	}

	c.JSON(http.StatusOK, gin.H{
		"project":    p,
		"payments":   payments,
		"tasks":      tasks,
		"client":     client,
		"reminders":  reminders,
		"milestones": msViews,
	})
}

func (h *Handler) CreateProject(c *gin.Context) {
	var in projectInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		badRequest(c, "项目名称必填")
		return
	}
	p := in.toModel()
	if p.Kind == "" {
		p.Kind = "outsource"
	}
	if p.Status == "" {
		p.Status = "active"
	}
	if err := h.DB.Create(&p).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.syncTags("project", p.ID, in.Tags)
	if p.ClientID != nil && *p.ClientID > 0 {
		var cnt int64
		h.DB.Model(&model.Client{}).Where("id = ?", *p.ClientID).Count(&cnt)
		if cnt == 0 {
			badRequest(c, "客户不存在")
			return
		}
	}
	list := []model.Project{p}
	fillCommission(list)
	c.JSON(http.StatusCreated, list[0])
}

func (h *Handler) UpdateProject(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Project
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "项目不存在")
		return
	}
	var in projectInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{
		"name": in.Name, "kind": in.Kind, "status": in.Status, "summary": in.Summary,
		"source_path": in.SourcePath, "online_url": in.OnlineURL, "admin_url": in.AdminURL,
		"git_repo": in.GitRepo, "deploy_at": in.DeployAt, "tech_stack": in.TechStack,
		"client_id": in.ClientID, "quote": in.Quote, "cost": in.Cost,
		"commission_type": in.CommissionType, "commission_rate": in.CommissionRate, "broker": in.Broker,
		"start_date": mustParseDate(in.StartDate), "due_date": mustParseDate(in.DueDate),
		"estimate_minutes": in.EstimateMinutes, "actual_minutes": in.ActualMinutes,
		"note": in.Note,
	}
	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.syncTags("project", id, in.Tags)
	var fresh model.Project
	h.DB.First(&fresh, id)
	list := []model.Project{fresh}
	h.fillProjectStats(list)
	fillCommission(list)
	c.JSON(http.StatusOK, list[0])
}

func (h *Handler) DeleteProject(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&model.Project{}, id).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.Payment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.Reminder{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.Milestone{}).Error; err != nil {
			return err
		}
		return tx.Where("target = ? AND target_id = ?", "project", id).Delete(&model.Taggable{}).Error
	})
	if err != nil {
		serverErr(c, err)
		return
	}
	// 项目下的图片连同磁盘文件一起清（事务外做，因为要读文件系统）
	h.dropAttachmentsBy("project_id", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// syncTags 用逗号分隔的标签名同步
func (h *Handler) syncTags(target string, targetID uint, tags []string) {
	h.DB.Where("target = ? AND target_id = ?", target, targetID).Delete(&model.Taggable{})
	for _, name := range tags {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		var t model.Tag
		if err := h.DB.Where("name = ?", name).First(&t).Error; err != nil {
			t = model.Tag{Name: name, Color: "#f97316"}
			if err := h.DB.Create(&t).Error; err != nil {
				continue
			}
		}
		h.DB.Create(&model.Taggable{TagID: t.ID, TargetID: targetID, Target: target})
	}
}

// ---------- 收款 ----------

// 派生收款状态：约定日已过且还没到账 → 逾期。
// 「中介说下个月结」这类口头约定，到点没到账必须能一眼看出来，
// 否则只能靠人记性，这正是这个功能存在的意义。
func decoratePayments(items []model.Payment) {
	today := time.Now()
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, today.Location())
	for i := range items {
		p := &items[i]
		if p.Status == "received" || p.PlanDate == nil {
			continue
		}
		plan := time.Date(p.PlanDate.Year(), p.PlanDate.Month(), p.PlanDate.Day(), 0, 0, 0, 0, today.Location())
		if plan.Before(today) {
			p.Overdue = true
			p.DaysLate = int(today.Sub(plan).Hours() / 24)
		}
	}
}

// 给收款记录补上项目名，列表页不用再单独查项目
func (h *Handler) fillPaymentProjectNames(items []model.Payment) {
	ids := make([]uint, 0, len(items))
	seen := map[uint]bool{}
	for _, p := range items {
		if !seen[p.ProjectID] {
			seen[p.ProjectID] = true
			ids = append(ids, p.ProjectID)
		}
	}
	if len(ids) == 0 {
		return
	}
	var projects []model.Project
	h.DB.Select("id", "name").Where("id IN ?", ids).Find(&projects)
	names := make(map[uint]string, len(projects))
	for _, pr := range projects {
		names[pr.ID] = pr.Name
	}
	for i := range items {
		items[i].ProjectName = names[items[i].ProjectID]
	}
}

func (h *Handler) ListPayments(c *gin.Context) {
	page, size := paginate(c)
	q := h.DB.Model(&model.Payment{})
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	var total int64
	q.Count(&total)
	var items []model.Payment
	if err := q.Order("plan_date ASC, id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	decoratePayments(items)
	h.fillPaymentProjectNames(items)
	c.JSON(http.StatusOK, paginated(items, total, page, size))
}

type paymentInput struct {
	ProjectID uint    `json:"projectId"`
	Title     string  `json:"title"`
	Amount    float64 `json:"amount"`
	Status    string  `json:"status"`
	PlanDate  string  `json:"planDate"`
	PaidDate  string  `json:"paidDate"`
	Note      string  `json:"note"`
}

func (h *Handler) CreatePayment(c *gin.Context) {
	var in paymentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if in.ProjectID == 0 {
		badRequest(c, "必须指定项目")
		return
	}
	var cnt int64
	h.DB.Model(&model.Project{}).Where("id = ?", in.ProjectID).Count(&cnt)
	if cnt == 0 {
		badRequest(c, "项目不存在")
		return
	}
	p := model.Payment{
		ProjectID: in.ProjectID, Title: in.Title, Amount: in.Amount,
		Status: in.Status, PlanDate: mustParseDate(in.PlanDate),
		PaidDate: mustParseDate(in.PaidDate), Note: in.Note,
	}
	if p.Status == "" {
		p.Status = "pending"
	}
	if p.Status == "received" && p.PaidDate == nil {
		now := time.Now()
		p.PaidDate = &now
	}
	if err := h.DB.Create(&p).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, p)
}

func (h *Handler) UpdatePayment(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Payment
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "收款记录不存在")
		return
	}
	var in paymentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{
		"title": in.Title, "amount": in.Amount, "status": in.Status,
		"plan_date": mustParseDate(in.PlanDate), "paid_date": mustParseDate(in.PaidDate),
		"note": in.Note,
	}
	if in.Status == "received" && cur.PaidDate == nil && in.PaidDate == "" {
		now := time.Now()
		updates["paid_date"] = &now
	}
	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(&cur, id)
	c.JSON(http.StatusOK, cur)
}

func (h *Handler) DeletePayment(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.Delete(&model.Payment{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

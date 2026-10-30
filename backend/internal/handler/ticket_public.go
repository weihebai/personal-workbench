package handler

import (
	"net/http"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

const ticketGone = "工单不存在或已失效"

// 公开页统一响应头：不缓存、不被收录、不带 Referer。
func setPublicNoIndex(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Robots-Tag", "noindex, nofollow, noarchive")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
}

func (h *Handler) projectByFeedbackToken(c *gin.Context) (*model.Project, bool) {
	token := c.Param("token")
	if len(token) != 64 {
		notFound(c, publicShareGone)
		return nil, false
	}
	var p model.Project
	if err := h.DB.Where("feedback_token = ?", token).First(&p).Error; err != nil {
		notFound(c, publicShareGone)
		return nil, false
	}
	return &p, true
}

// 工单 Token 只对应一张工单，客户看不到同项目的其他工单。
func (h *Handler) ticketByAccessToken(c *gin.Context) (*model.Ticket, bool) {
	token := c.Param("token")
	if len(token) != 64 {
		notFound(c, ticketGone)
		return nil, false
	}
	var t model.Ticket
	if err := h.DB.Where("access_token = ?", token).First(&t).Error; err != nil {
		notFound(c, ticketGone)
		return nil, false
	}
	return &t, true
}

// ---------- 项目提报链接（内部） ----------

// POST /api/projects/:id/feedback-token
func (h *Handler) CreateProjectFeedbackToken(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var p model.Project
	if err := h.DB.First(&p, id).Error; err != nil {
		notFound(c, "项目不存在")
		return
	}
	token := ""
	if p.FeedbackToken != nil {
		token = *p.FeedbackToken
	}
	if token == "" {
		fresh, err := newShareToken()
		if err != nil {
			serverErr(c, err)
			return
		}
		token = fresh
	}
	if err := h.DB.Model(&p).Update("feedback_token", token).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(&p, id)
	p.FeedbackPath = "/feedback/" + token
	c.JSON(http.StatusOK, p)
}

// POST /api/projects/:id/feedback-token/rotate
func (h *Handler) RotateProjectFeedbackToken(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var p model.Project
	if err := h.DB.First(&p, id).Error; err != nil {
		notFound(c, "项目不存在")
		return
	}
	if p.FeedbackToken == nil || *p.FeedbackToken == "" {
		badRequest(c, "还没有提报链接，请先生成")
		return
	}
	fresh, err := newShareToken()
	if err != nil {
		serverErr(c, err)
		return
	}
	if err := h.DB.Model(&p).Update("feedback_token", fresh).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.First(&p, id)
	p.FeedbackPath = "/feedback/" + fresh
	c.JSON(http.StatusOK, p)
}

// DELETE /api/projects/:id/feedback-token
func (h *Handler) RevokeProjectFeedbackToken(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.Model(&model.Project{}).Where("id = ?", id).Update("feedback_token", nil).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---------- 公开接口 ----------

type publicTicketMessage struct {
	Side       string    `json:"side"`
	Body       string    `json:"body"`
	AuthorName string    `json:"authorName"`
	CreatedAt  time.Time `json:"createdAt"`
}

type publicTicketView struct {
	No          string                `json:"no"`
	Title       string                `json:"title"`
	Desc        string                `json:"desc"`
	Expect      string                `json:"expect"`
	PageURL     string                `json:"pageUrl"`
	Status      string                `json:"status"`
	Round       int                   `json:"round"`
	Reporter    string                `json:"reporter"`
	CloseNote   string                `json:"closeNote"`
	ProjectName string                `json:"projectName"`
	CreatedAt   time.Time             `json:"createdAt"`
	UpdatedAt   time.Time             `json:"updatedAt"`
	ClosedAt    *time.Time            `json:"closedAt"`
	Messages    []publicTicketMessage `json:"messages"`
	Attachments []publicAttachment    `json:"attachments"`
}

func (h *Handler) publicTicketPayload(t *model.Ticket) publicTicketView {
	var proj model.Project
	h.DB.Select("id, name").First(&proj, t.ProjectID)

	// 只出 public 条目：内部备注绝不能进公开响应
	var msgs []model.TicketMessage
	h.DB.Where("ticket_id = ? AND visibility = ?", t.ID, "public").Order("id ASC").Find(&msgs)
	out := make([]publicTicketMessage, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, publicTicketMessage{
			Side: m.Side, Body: m.Body, AuthorName: m.AuthorName, CreatedAt: m.CreatedAt,
		})
	}

	var atts []model.Attachment
	h.DB.Where("ticket_id = ?", t.ID).Order("id ASC").Find(&atts)
	av := make([]publicAttachment, 0, len(atts))
	for _, a := range atts {
		av = append(av, publicAttachment{
			URL: "/api/attachments/" + a.Hash + "/raw", Width: a.Width, Height: a.Height,
		})
	}

	return publicTicketView{
		No: ticketNo(t.ID), Title: t.Title, Desc: t.Desc, Expect: t.Expect,
		PageURL: t.PageURL, Status: t.Status, Round: t.Round, Reporter: t.Reporter,
		CloseNote: t.CloseNote, ProjectName: proj.Name,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt, ClosedAt: t.ClosedAt,
		Messages: out, Attachments: av,
	}
}

// GET /api/public/feedback/:token  客户入口：项目信息 + 自己在该项目下提交过的工单
func (h *Handler) GetPublicFeedback(c *gin.Context) {
	setPublicNoIndex(c)
	p, ok := h.projectByFeedbackToken(c)
	if !ok {
		return
	}

	// 一个项目对应一个客户，所以项目链接可以安全地列出该项目的全部工单；
	// 只给摘要和访问路径，不返回反馈人、联系方式这类内部字段。
	type ticketBrief struct {
		No         string    `json:"no"`
		Title      string    `json:"title"`
		Status     string    `json:"status"`
		Round      int       `json:"round"`
		UpdatedAt  time.Time `json:"updatedAt"`
		AccessPath string    `json:"accessPath"`
	}
	var list []model.Ticket
	h.DB.Where("project_id = ?", p.ID).Order("updated_at DESC").Limit(50).Find(&list)
	items := make([]ticketBrief, 0, len(list))
	for _, t := range list {
		if t.AccessToken == nil || *t.AccessToken == "" {
			continue
		}
		items = append(items, ticketBrief{
			No: ticketNo(t.ID), Title: t.Title, Status: t.Status, Round: t.Round,
			UpdatedAt: t.UpdatedAt, AccessPath: "/t/" + *t.AccessToken,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"projectName":    p.Name,
		"projectSummary": p.Summary,
		"tickets":        items,
	})
}

// POST /api/public/feedback/:token/tickets  客户提交工单
func (h *Handler) SubmitPublicTicket(c *gin.Context) {
	setPublicNoIndex(c)
	p, ok := h.projectByFeedbackToken(c)
	if !ok {
		return
	}
	var in struct {
		Title    string `json:"title"`
		Desc     string `json:"desc"`
		Expect   string `json:"expect"`
		PageURL  string `json:"pageUrl"`
		Reporter string `json:"reporter"`
		Contact  string `json:"contact"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		badRequest(c, "请填写问题标题")
		return
	}
	if strings.TrimSpace(in.Desc) == "" {
		badRequest(c, "请描述遇到的问题")
		return
	}

	token, err := newShareToken()
	if err != nil {
		serverErr(c, err)
		return
	}
	t := model.Ticket{
		ProjectID: p.ID, ClientID: p.ClientID,
		Title: truncate(in.Title, 255), Desc: in.Desc, Expect: in.Expect,
		PageURL: truncate(in.PageURL, 1024), Reporter: truncate(in.Reporter, 64),
		Contact: truncate(in.Contact, 128), Status: "pending", AccessToken: &token,
	}
	if err := h.DB.Create(&t).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.Create(&model.TicketMessage{
		TicketID: t.ID, Side: "customer", Visibility: "public",
		Body: t.Desc, AuthorName: t.Reporter,
	})
	h.notifyNewTicket(&t, p.Name)

	// 访问 Token 只在提交成功时返回这一次，之后只能靠客户自己保存的链接
	c.JSON(http.StatusCreated, gin.H{
		"no":         ticketNo(t.ID),
		"accessPath": "/t/" + token,
	})
}

// GET /api/public/tickets/:token
func (h *Handler) GetPublicTicket(c *gin.Context) {
	setPublicNoIndex(c)
	t, ok := h.ticketByAccessToken(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, h.publicTicketPayload(t))
}

// POST /api/public/tickets/:token/messages  客户补充
func (h *Handler) PostPublicTicketMessage(c *gin.Context) {
	setPublicNoIndex(c)
	t, ok := h.ticketByAccessToken(c)
	if !ok {
		return
	}
	var in struct {
		Body   string `json:"body"`
		Author string `json:"author"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(in.Body) == "" {
		badRequest(c, "内容不能为空")
		return
	}
	h.DB.Create(&model.TicketMessage{
		TicketID: t.ID, Side: "customer", Visibility: "public",
		Body: in.Body, AuthorName: truncate(in.Author, 64),
	})
	// 已结案的工单又被客户追问：重新打开，轮次加一
	if t.Status == "closed" {
		h.DB.Model(t).Updates(map[string]any{
			"status": "doing", "round": t.Round + 1, "closed_at": nil,
		})
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /api/public/tickets/:token/confirm  客户确认或打回
func (h *Handler) ConfirmPublicTicket(c *gin.Context) {
	setPublicNoIndex(c)
	t, ok := h.ticketByAccessToken(c)
	if !ok {
		return
	}
	var in struct {
		OK     bool   `json:"ok"`
		Reason string `json:"reason"`
		Author string `json:"author"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}

	if in.OK {
		now := time.Now()
		updates := map[string]any{"status": "closed", "closed_at": &now}
		if t.Status != "waiting" {
			badRequest(c, "只有「待确认」的工单可以确认关闭")
			return
		}
		if err := h.DB.Model(t).Updates(updates).Error; err != nil {
			serverErr(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	// 打回：轮次加一，回到处理中，打回原因记进沟通记录
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		badRequest(c, "请说明还没解决的地方")
		return
	}
	if err := h.DB.Model(t).Updates(map[string]any{
		"status": "doing", "round": t.Round + 1,
	}).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.DB.Create(&model.TicketMessage{
		TicketID: t.ID, Side: "customer", Visibility: "public",
		Body: "【打回】" + reason, AuthorName: truncate(in.Author, 64),
	})
	c.JSON(http.StatusOK, gin.H{"ok": true, "round": t.Round + 1})
}

// POST /api/public/tickets/:token/attachments  客户传截图
func (h *Handler) UploadPublicTicketAttachment(c *gin.Context) {
	setPublicNoIndex(c)
	t, ok := h.ticketByAccessToken(c)
	if !ok {
		return
	}
	tid := t.ID
	att, code, msg := h.storeImage(c, nil, nil, nil, &tid)
	if att == nil {
		fail(c, code, msg)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"url": "/api/attachments/" + att.Hash + "/raw", "width": att.Width, "height": att.Height,
	})
}

package handler

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"personal-workbench/internal/model"
	"personal-workbench/internal/notify"

	"github.com/gin-gonic/gin"
)

// 工单状态取值。waiting 之后只能由客户确认或人工结案，AI 不能直接推到 closed。
var ticketStatuses = map[string]bool{
	"pending": true,
	"doing":   true,
	"waiting": true,
	"closed":  true,
}

// 工单号从主键派生：不额外维护自增计数，避免并发下重号，也不用迁移历史数据。
func ticketNo(id uint) string { return fmt.Sprintf("WT-%06d", id) }

func taskNo(id uint) string { return fmt.Sprintf("T-%06d", id) }

// 工单号解析：接受 WT-000012 / wt-12 / 12 三种写法，方便 AI 直接拿编号查询。
func parseTicketNo(s string) (uint, bool) {
	s = strings.TrimSpace(strings.ToUpper(s))
	s = strings.TrimPrefix(s, "WT-")
	s = strings.TrimPrefix(s, "#")
	if s == "" {
		return 0, false
	}
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil || v == 0 {
		return 0, false
	}
	return uint(v), true
}

type ticketMessageView struct {
	model.TicketMessage
}

// 批量补齐只读字段：项目名 / 客户名 / 编号 / 消息数 / 访问路径。
func (h *Handler) decorateTickets(list []model.Ticket, withDetail bool) {
	if len(list) == 0 {
		return
	}
	projIDs := make([]uint, 0, len(list))
	for _, t := range list {
		projIDs = append(projIDs, t.ProjectID)
	}
	projName := map[uint]string{}
	var ps []model.Project
	h.DB.Select("id, name").Where("id IN ?", projIDs).Find(&ps)
	for _, p := range ps {
		projName[p.ID] = p.Name
	}

	cliIDs := []uint{}
	for _, t := range list {
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

	ticketIDs := make([]uint, 0, len(list))
	for _, t := range list {
		ticketIDs = append(ticketIDs, t.ID)
	}
	counts := map[uint]int64{}
	var rows []struct {
		TicketID uint
		N        int64
	}
	h.DB.Model(&model.TicketMessage{}).
		Select("ticket_id, count(*) as n").
		Where("ticket_id IN ?", ticketIDs).
		Group("ticket_id").Scan(&rows)
	for _, r := range rows {
		counts[r.TicketID] = r.N
	}

	for i := range list {
		t := &list[i]
		t.No = ticketNo(t.ID)
		t.ProjectName = projName[t.ProjectID]
		if t.ClientID != nil {
			t.ClientName = cliName[*t.ClientID]
		}
		t.MessageCount = int(counts[t.ID])
		if t.AccessToken != nil && *t.AccessToken != "" {
			t.AccessPath = "/t/" + *t.AccessToken
		}
	}

	if !withDetail {
		return
	}

	ids := make([]uint, 0, len(list))
	for _, t := range list {
		ids = append(ids, t.ID)
	}
	var msgs []model.TicketMessage
	h.DB.Where("ticket_id IN ?", ids).Order("id ASC").Find(&msgs)
	byTicket := map[uint][]model.TicketMessage{}
	for _, m := range msgs {
		byTicket[m.TicketID] = append(byTicket[m.TicketID], m)
	}
	var atts []model.Attachment
	h.DB.Where("ticket_id IN ?", ids).Order("id ASC").Find(&atts)
	attByTicket := map[uint][]model.Attachment{}
	for _, a := range atts {
		a.URL = "/api/attachments/" + a.Hash + "/raw"
		attByTicket[*a.TicketID] = append(attByTicket[*a.TicketID], a)
	}
	for i := range list {
		list[i].Messages = byTicket[list[i].ID]
		list[i].Attachments = attByTicket[list[i].ID]
	}
}

// GET /api/tickets?status=&projectId=&q=
func (h *Handler) ListTickets(c *gin.Context) {
	page, size := paginate(c)
	q := h.DB.Model(&model.Ticket{})
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		// 支持直接贴编号（WT-000012）查
		if id, ok := parseTicketNo(s); ok && strings.HasPrefix(strings.ToUpper(s), "WT") {
			q = q.Where("id = ?", id)
		} else {
			like := "%" + s + "%"
			q = q.Where("title LIKE ? OR desc LIKE ? OR expect LIKE ? OR reporter LIKE ?", like, like, like, like)
		}
	}
	if v := c.Query("status"); v != "" {
		q = q.Where("status = ?", v)
	}
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}
	if id := queryUint(c, "clientId"); id != nil {
		q = q.Where("client_id = ?", *id)
	}

	var total int64
	q.Count(&total)
	var items []model.Ticket
	if err := q.Order("updated_at DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.decorateTickets(items, false)
	c.JSON(http.StatusOK, paginated(items, total, page, size))
}

// GET /api/tickets/:id
func (h *Handler) GetTicket(c *gin.Context) {
	var item model.Ticket
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.First(&item, id).Error; err != nil {
		notFound(c, "工单不存在")
		return
	}
	list := []model.Ticket{item}
	h.decorateTickets(list, true)
	c.JSON(http.StatusOK, list[0])
}

type ticketInput struct {
	ProjectID uint   `json:"projectId"`
	ClientID  *uint  `json:"clientId"`
	Title     string `json:"title"`
	Desc      string `json:"desc"`
	Expect    string `json:"expect"`
	PageURL   string `json:"pageUrl"`
	Reporter  string `json:"reporter"`
	Contact   string `json:"contact"`
	Status    string `json:"status"`
}

// POST /api/tickets  内部建单，也供 MCP 代客户录入
func (h *Handler) CreateTicket(c *gin.Context) {
	var in ticketInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		badRequest(c, "工单标题必填")
		return
	}
	if in.ProjectID == 0 {
		badRequest(c, "必须指定所属项目")
		return
	}
	var proj model.Project
	if err := h.DB.First(&proj, in.ProjectID).Error; err != nil {
		badRequest(c, "项目不存在")
		return
	}
	status := in.Status
	if status == "" {
		status = "pending"
	}
	if !ticketStatuses[status] {
		badRequest(c, "无效的工单状态")
		return
	}
	clientID := in.ClientID
	if clientID == nil {
		clientID = proj.ClientID
	}

	token, err := newShareToken()
	if err != nil {
		serverErr(c, err)
		return
	}
	t := model.Ticket{
		ProjectID: in.ProjectID, ClientID: clientID,
		Title: in.Title, Desc: in.Desc, Expect: in.Expect, PageURL: in.PageURL,
		Reporter: in.Reporter, Contact: in.Contact,
		Status: status, AccessToken: &token,
	}
	if err := h.DB.Create(&t).Error; err != nil {
		serverErr(c, err)
		return
	}
	// 客户原始描述作为第一条沟通记录，后面追加的都在它之后
	if strings.TrimSpace(in.Desc) != "" {
		h.DB.Create(&model.TicketMessage{
			TicketID: t.ID, Side: "customer", Visibility: "public",
			Body: in.Desc, AuthorName: in.Reporter,
		})
	}
	h.notifyNewTicket(&t, proj.Name)
	list := []model.Ticket{t}
	h.decorateTickets(list, true)
	c.JSON(http.StatusCreated, list[0])
}

// PUT /api/tickets/:id  部分更新：改状态、补充信息、追加回复、结案
func (h *Handler) UpdateTicket(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Ticket
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "工单不存在")
		return
	}

	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{}
	for js, col := range map[string]string{
		"title": "title", "desc": "desc", "expect": "expect",
		"pageUrl": "page_url", "reporter": "reporter", "contact": "contact",
		"closeNote": "close_note",
	} {
		if v, exists := raw[js]; exists {
			updates[col] = toString(v)
		}
	}
	if v, exists := raw["projectId"]; exists {
		if f, ok := toFloat(v); ok && f > 0 {
			updates["project_id"] = uint(f)
		}
	}
	if v, exists := raw["status"]; exists {
		s := toString(v)
		if !ticketStatuses[s] {
			badRequest(c, "无效的工单状态")
			return
		}
		updates["status"] = s
		if s == "closed" {
			now := time.Now()
			updates["closed_at"] = &now
		} else if cur.Status == "closed" {
			updates["closed_at"] = nil
		}
	}

	if len(updates) > 0 {
		if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
			serverErr(c, err)
			return
		}
	}

	// 内部回复：Visibility 默认 internal，避免把内部备注同步给客户
	if v, exists := raw["message"]; exists {
		body := strings.TrimSpace(toString(v))
		if body != "" {
			vis := toString(raw["visibility"])
			if vis != "public" {
				vis = "internal"
			}
			h.DB.Create(&model.TicketMessage{
				TicketID: cur.ID, Side: "owner", Visibility: vis, Body: body,
				AuthorName: toString(raw["author"]),
			})
		}
	}

	var item model.Ticket
	h.DB.First(&item, id)
	list := []model.Ticket{item}
	h.decorateTickets(list, true)
	c.JSON(http.StatusOK, list[0])
}

// DELETE /api/tickets/:id
func (h *Handler) DeleteTicket(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	h.DB.Where("ticket_id = ?", id).Delete(&model.TicketMessage{})
	h.dropAttachmentsBy("ticket_id", id)
	if err := h.DB.Delete(&model.Ticket{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// 新工单邮件提醒：复用到期提醒的 SMTP 配置，没配置就静默跳过。
// 异步发送，不能因为邮件服务器慢就把客户的提交请求拖住。
func (h *Handler) notifyNewTicket(t *model.Ticket, projectName string) {
	if h.settingValue(smtpEnabledKey) != "1" {
		return
	}
	cfg, ok := h.smtpConfig()
	if !ok {
		return
	}

	var b strings.Builder
	fmt.Fprintf(&b, "项目：%s\n", projectName)
	fmt.Fprintf(&b, "工单：%s\n", ticketNo(t.ID))
	fmt.Fprintf(&b, "标题：%s\n", t.Title)
	if t.Reporter != "" {
		fmt.Fprintf(&b, "反馈人：%s\n", t.Reporter)
	}
	if t.Contact != "" {
		fmt.Fprintf(&b, "联系方式：%s\n", t.Contact)
	}
	if t.PageURL != "" {
		fmt.Fprintf(&b, "页面：%s\n", t.PageURL)
	}
	if t.Desc != "" {
		fmt.Fprintf(&b, "\n问题描述：\n%s\n", t.Desc)
	}
	if t.Expect != "" {
		fmt.Fprintf(&b, "\n期望效果：\n%s\n", t.Expect)
	}
	fmt.Fprintf(&b, "\n提交时间：%s\n", time.Now().Format("2006-01-02 15:04"))

	subject := fmt.Sprintf("新工单 %s：%s", ticketNo(t.ID), t.Title)
	go func() {
		if err := notify.Send(cfg, subject, b.String()); err != nil {
			log.Printf("工单邮件发送失败: %v", err)
		}
	}()
}

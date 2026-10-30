package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

func newTicketRouter(h *Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/public/feedback/:token", h.GetPublicFeedback)
	r.POST("/public/feedback/:token/tickets", h.SubmitPublicTicket)
	r.GET("/public/tickets/:token", h.GetPublicTicket)
	r.POST("/public/tickets/:token/messages", h.PostPublicTicketMessage)
	r.POST("/public/tickets/:token/confirm", h.ConfirmPublicTicket)
	return r
}

func ticketDo[T any](t *testing.T, r *gin.Engine, method, path string, payload any) (int, T) {
	t.Helper()
	var body *strings.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("序列化失败: %v", err)
		}
		body = strings.NewReader(string(b))
	} else {
		body = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var out T
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("解析失败: %v\n%s", err, w.Body.String())
		}
	}
	return w.Code, out
}

// 编号要能从主键稳定生成，也要能被 AI 直接反解回主键。
func TestTicketNoRoundTrip(t *testing.T) {
	if got := ticketNo(12); got != "WT-000012" {
		t.Fatalf("工单号格式不对: %s", got)
	}
	for _, in := range []string{"WT-000012", "wt-12", "#12", "12"} {
		id, ok := parseTicketNo(in)
		if !ok || id != 12 {
			t.Fatalf("解析 %q 得到 %d/%v", in, id, ok)
		}
	}
	if _, ok := parseTicketNo("WT-"); ok {
		t.Fatal("空编号不该解析成功")
	}
	if got := taskNo(7); got != "T-000007" {
		t.Fatalf("任务号格式不对: %s", got)
	}
}

// 客户只能通过自己的工单 Token 访问，项目提报 Token 不能当工单 Token 用。
func TestPublicTicketTokenIsolation(t *testing.T) {
	h, _ := newTestHandler(t)
	h.DB.Create(&model.Project{Name: "测试项目"})
	r := newTicketRouter(h)

	projectToken := strings.Repeat("a", 64)
	h.DB.Model(&model.Project{}).Where("1 = 1").Update("feedback_token", projectToken)

	code, _ := ticketDo[map[string]any](t, r, http.MethodGet, "/public/tickets/"+projectToken, nil)
	if code != http.StatusNotFound {
		t.Fatalf("项目 Token 不能读工单，期望 404，实际 %d", code)
	}

	code, _ = ticketDo[map[string]any](t, r, http.MethodGet, "/public/tickets/short", nil)
	if code != http.StatusNotFound {
		t.Fatalf("长度不对的 Token 期望 404，实际 %d", code)
	}
}

// 内部备注绝不能出现在公开响应里：这是工单系统最容易漏数据的地方。
func TestPublicTicketHidesInternalNotes(t *testing.T) {
	h, _ := newTestHandler(t)
	proj := model.Project{Name: "客户系统"}
	h.DB.Create(&proj)
	token := strings.Repeat("b", 64)
	h.DB.Model(&proj).Update("feedback_token", token)

	r := newTicketRouter(h)
	code, created := ticketDo[struct {
		No         string `json:"no"`
		AccessPath string `json:"accessPath"`
	}](t, r, http.MethodPost, "/public/feedback/"+token+"/tickets", map[string]any{
		"title": "按钮点不动", "desc": "详情页保存按钮没反应", "expect": "能正常保存",
	})
	if code != http.StatusCreated || created.AccessPath == "" {
		t.Fatalf("提交失败: %d %s", code, created.AccessPath)
	}
	ticketToken := strings.TrimPrefix(created.AccessPath, "/t/")

	var tkt model.Ticket
	h.DB.Where("access_token = ?", ticketToken).First(&tkt)
	h.DB.Create(&model.TicketMessage{
		TicketID: tkt.ID, Side: "owner", Visibility: "internal",
		Body: "这条是内部备注，客户不该看到",
	})

	code, detail := ticketDo[publicTicketView](t, r, http.MethodGet, "/public/tickets/"+ticketToken, nil)
	if code != http.StatusOK {
		t.Fatalf("读取工单失败: %d", code)
	}
	if detail.No != "WT-000001" {
		t.Fatalf("工单号不对: %s", detail.No)
	}
	if detail.Status != "pending" {
		t.Fatalf("新工单状态应为 pending，实际 %s", detail.Status)
	}
	for _, m := range detail.Messages {
		if strings.Contains(m.Body, "内部备注") {
			t.Fatal("公开接口泄露了内部备注")
		}
	}
}

// 客户打回：轮次加一，回到处理中，打回原因记进沟通记录。
func TestTicketRejectBumpsRound(t *testing.T) {
	h, _ := newTestHandler(t)
	proj := model.Project{Name: "客户系统"}
	h.DB.Create(&proj)
	token := strings.Repeat("c", 64)
	h.DB.Model(&proj).Update("feedback_token", token)

	r := newTicketRouter(h)
	code, created := ticketDo[struct {
		AccessPath string `json:"accessPath"`
	}](t, r, http.MethodPost, "/public/feedback/"+token+"/tickets", map[string]any{
		"title": "导出报错", "desc": "点导出提示 500",
	})
	if code != http.StatusCreated {
		t.Fatalf("提交失败: %d", code)
	}
	ticketToken := strings.TrimPrefix(created.AccessPath, "/t/")

	var tkt model.Ticket
	h.DB.Where("access_token = ?", ticketToken).First(&tkt)
	h.DB.Model(&tkt).Update("status", "waiting")

	code, _ = ticketDo[map[string]any](t, r, http.MethodPost, "/public/tickets/"+ticketToken+"/confirm",
		map[string]any{"ok": false, "reason": "还是报错"})
	if code != http.StatusOK {
		t.Fatalf("打回失败: %d", code)
	}

	h.DB.First(&tkt, tkt.ID)
	if tkt.Status != "doing" || tkt.Round != 1 {
		t.Fatalf("打回后应为 doing/1，实际 %s/%d", tkt.Status, tkt.Round)
	}
}

// 项目提报链接能看到本项目的工单摘要，但看不到别的项目的。
// 前提是一个项目只对应一个客户，链接本身就是这个客户的入口。
func TestPublicFeedbackListsOwnProjectTickets(t *testing.T) {
	h, _ := newTestHandler(t)
	p1 := model.Project{Name: "客户 A"}
	p2 := model.Project{Name: "客户 B"}
	h.DB.Create(&p1)
	h.DB.Create(&p2)
	tok1 := strings.Repeat("e", 64)
	tok2 := strings.Repeat("f", 64)
	h.DB.Model(&p1).Update("feedback_token", tok1)
	h.DB.Model(&p2).Update("feedback_token", tok2)

	r := newTicketRouter(h)
	for _, item := range []struct{ tok, title string }{
		{tok1, "A 的问题"},
		{tok2, "B 的问题"},
		{tok1, "A 的第二个问题"},
	} {
		code, _ := ticketDo[map[string]any](t, r, http.MethodPost, "/public/feedback/"+item.tok+"/tickets",
			map[string]any{"title": item.title, "desc": "描述"})
		if code != http.StatusCreated {
			t.Fatalf("提交失败: %d", code)
		}
	}

	type brief struct {
		No         string `json:"no"`
		Title      string `json:"title"`
		AccessPath string `json:"accessPath"`
	}
	type page struct {
		ProjectName string  `json:"projectName"`
		Tickets     []brief `json:"tickets"`
	}
	code, got := ticketDo[page](t, r, http.MethodGet, "/public/feedback/"+tok1, nil)
	if code != http.StatusOK {
		t.Fatalf("读取提报页失败: %d", code)
	}
	if len(got.Tickets) != 2 {
		t.Fatalf("应只看到本项目的 2 张工单，实际 %d 张", len(got.Tickets))
	}
	for _, item := range got.Tickets {
		if strings.Contains(item.Title, "B 的问题") {
			t.Fatal("泄露了其他项目的工单")
		}
		if item.AccessPath == "" {
			t.Fatal("工单摘要缺少访问路径，客户点不进去")
		}
	}
}

// 只有「待客户确认」的工单能确认关闭，避免客户直接关掉还在处理的单子。
func TestTicketConfirmOnlyWhenWaiting(t *testing.T) {
	h, _ := newTestHandler(t)
	proj := model.Project{Name: "客户系统"}
	h.DB.Create(&proj)
	token := strings.Repeat("d", 64)
	h.DB.Model(&proj).Update("feedback_token", token)

	r := newTicketRouter(h)
	_, created := ticketDo[struct {
		AccessPath string `json:"accessPath"`
	}](t, r, http.MethodPost, "/public/feedback/"+token+"/tickets", map[string]any{
		"title": "样式错位", "desc": "移动端标题溢出",
	})
	ticketToken := strings.TrimPrefix(created.AccessPath, "/t/")

	code, _ := ticketDo[map[string]any](t, r, http.MethodPost, "/public/tickets/"+ticketToken+"/confirm",
		map[string]any{"ok": true})
	if code != http.StatusBadRequest {
		t.Fatalf("pending 状态不该允许确认关闭，实际 %d", code)
	}
}

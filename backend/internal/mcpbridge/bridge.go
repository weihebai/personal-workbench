// Package mcpbridge 把工作台的 HTTP API 包装成 MCP 工具，供 MCP 服务器挂载。
//
// 不直连数据库，只走 API——被 cmd/mcp（stdio 本地模式）和 cmd/server
// （/mcp 路由，线上远程模式）共用。鉴权用账号密码登录换 JWT，token 过期自动重登。
package mcpbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Client 工作台 API 的 HTTP 客户端
type Client struct {
	base  string
	user  string
	pass  string
	http  *http.Client
	mu    sync.Mutex
	token string
}

func NewClient(base, user, pass string) *Client {
	return &Client{
		base: strings.TrimRight(base, "/"),
		user: user,
		pass: pass,
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Login(ctx context.Context) error {
	var out struct {
		Token string `json:"token"`
	}
	err := c.raw(ctx, http.MethodPost, "/api/auth/login",
		map[string]string{"username": c.user, "password": c.pass}, &out, false)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.token = out.Token
	c.mu.Unlock()
	return nil
}

// do 发带鉴权的请求；401 时重登一次再试（JWT 默认 7 天过期）
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	err := c.raw(ctx, method, path, body, out, true)
	if err != nil && strings.Contains(err.Error(), "HTTP 401") {
		if lerr := c.Login(ctx); lerr != nil {
			return fmt.Errorf("登录工作台失败（检查账号密码与 WORKBENCH_URL）: %w", lerr)
		}
		return c.raw(ctx, method, path, body, out, true)
	}
	return err
}

func (c *Client) raw(ctx context.Context, method, path string, body, out any, auth bool) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if auth {
		c.mu.Lock()
		t := c.token
		c.mu.Unlock()
		req.Header.Set("Authorization", "Bearer "+t)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("请求工作台失败（WORKBENCH_URL=%s）: %w", c.base, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s: HTTP %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

// ok 把结果序列化成 JSON 文本返回给 AI
func ok(v any) (*mcp.CallToolResult, any, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}, nil, nil
}

// fail 作为「工具执行错误」返回（而不是协议错误），AI 能读到消息并自行调整
func fail(err error) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil, nil
}

// ---------- 工具定义 ----------

// RegisterTools 在 MCP 服务器上注册全部工具
func RegisterTools(server *mcp.Server, wb *Client) {
	type listProjectsIn struct {
		Status string `json:"status,omitempty" jsonschema:"按状态过滤，多个用英文逗号分隔：negotiating 洽谈中 / active 进行中 / delivered 已交付 / paid 已结款 / paused 已暂停 / archived 已归档；留空：全部"`
		Kind   string `json:"kind,omitempty" jsonschema:"按类型过滤：company 公司项目 / outsource 外包私活 / personal 个人项目；留空：全部"`
		Q      string `json:"q,omitempty" jsonschema:"关键词，匹配项目名/简介/技术栈/网址"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_projects",
		Description: "列出工作台的项目（含合同额、已收、抽成、计费方式汇总）。想改项目先从这里拿 id。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in listProjectsIn) (*mcp.CallToolResult, any, error) {
		var page struct {
			Items []projectBrief `json:"items"`
			Total int            `json:"total"`
		}
		if err := wb.do(ctx, http.MethodGet,
			"/api/projects?size=200&status="+in.Status+"&kind="+in.Kind+"&q="+in.Q, nil, &page); err != nil {
			return fail(err)
		}
		return ok(page)
	})

	type getProjectIn struct {
		ID uint64 `json:"id" jsonschema:"项目 ID"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_project",
		Description: "查看项目详情：基本信息、收款记录、任务、里程碑、工时记录。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in getProjectIn) (*mcp.CallToolResult, any, error) {
		var detail map[string]any
		if err := wb.do(ctx, http.MethodGet, fmt.Sprintf("/api/projects/%d", in.ID), nil, &detail); err != nil {
			return fail(err)
		}
		return ok(detail)
	})

	type createProjectIn struct {
		Name           string   `json:"name" jsonschema:"项目名（必填）"`
		Kind           string   `json:"kind,omitempty" jsonschema:"类型：company 公司项目 / outsource 外包私活 / personal 个人项目，默认 outsource"`
		Status         string   `json:"status,omitempty" jsonschema:"negotiating 洽谈中 / active 进行中 / delivered 已交付 / paid 已结款 / paused 已暂停 / archived 已归档，默认 active"`
		Summary        string   `json:"summary,omitempty" jsonschema:"一句话简介"`
		Quote          float64  `json:"quote,omitempty" jsonschema:"合同/报价总额；按工时计费时忽略，由工时自动算"`
		Cost           float64  `json:"cost,omitempty" jsonschema:"成本（服务器/第三方等）"`
		BillingMode    string   `json:"billingMode,omitempty" jsonschema:"计费方式：fixed 固定总价（默认）/ hourly 按工时"`
		HourlyRate     float64  `json:"hourlyRate,omitempty" jsonschema:"时薪（元/小时），按工时计费时必填"`
		CommissionType string   `json:"commissionType,omitempty" jsonschema:"抽成方式：none 无 / pct 按比例 / fixed 固定金额"`
		CommissionRate float64  `json:"commissionRate,omitempty" jsonschema:"抽成数值：pct 时是百分比(20 表示 20%)，fixed 时是金额"`
		Broker         string   `json:"broker,omitempty" jsonschema:"中介/渠道名"`
		StartDate      string   `json:"startDate,omitempty" jsonschema:"开始日期，如 2026-10-25"`
		DueDate        string   `json:"dueDate,omitempty" jsonschema:"截止日期，如 2026-11-01"`
		TechStack      string   `json:"techStack,omitempty" jsonschema:"技术栈"`
		SourcePath     string   `json:"sourcePath,omitempty" jsonschema:"本地源码目录"`
		OnlineURL      string   `json:"onlineUrl,omitempty" jsonschema:"线上网址"`
		AdminURL       string   `json:"adminUrl,omitempty" jsonschema:"管理后台网址"`
		GitRepo        string   `json:"gitRepo,omitempty" jsonschema:"Git 仓库地址"`
		Tags           []string `json:"tags,omitempty" jsonschema:"标签"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_project",
		Description: "创建项目。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createProjectIn) (*mcp.CallToolResult, any, error) {
		var created map[string]any
		if err := wb.do(ctx, http.MethodPost, "/api/projects", in, &created); err != nil {
			return fail(err)
		}
		return ok(created)
	})

	type updateProjectIn struct {
		ID             uint64   `json:"id" jsonschema:"项目 ID（必填，先用 list_projects 查）"`
		Name           *string  `json:"name,omitempty" jsonschema:"项目名"`
		Kind           *string  `json:"kind,omitempty" jsonschema:"类型：company / outsource / personal"`
		Status         *string  `json:"status,omitempty" jsonschema:"negotiating 洽谈中 / active 进行中 / delivered 已交付 / paid 已结款 / paused 已暂停 / archived 已归档"`
		Summary        *string  `json:"summary,omitempty" jsonschema:"一句话简介"`
		Quote          *float64 `json:"quote,omitempty" jsonschema:"合同/报价总额；按工时计费时忽略"`
		Cost           *float64 `json:"cost,omitempty" jsonschema:"成本"`
		BillingMode    *string  `json:"billingMode,omitempty" jsonschema:"计费方式：fixed 固定总价 / hourly 按工时"`
		HourlyRate     *float64 `json:"hourlyRate,omitempty" jsonschema:"时薪（元/小时）"`
		CommissionType *string  `json:"commissionType,omitempty" jsonschema:"抽成方式：none / pct / fixed"`
		CommissionRate *float64 `json:"commissionRate,omitempty" jsonschema:"抽成数值"`
		Broker         *string  `json:"broker,omitempty" jsonschema:"中介/渠道名"`
		StartDate      *string  `json:"startDate,omitempty" jsonschema:"开始日期；传空字符串清除"`
		DueDate        *string  `json:"dueDate,omitempty" jsonschema:"截止日期；传空字符串清除"`
		TechStack      *string  `json:"techStack,omitempty" jsonschema:"技术栈"`
		SourcePath     *string  `json:"sourcePath,omitempty" jsonschema:"本地源码目录"`
		OnlineURL      *string  `json:"onlineUrl,omitempty" jsonschema:"线上网址"`
		AdminURL       *string  `json:"adminUrl,omitempty" jsonschema:"管理后台网址"`
		GitRepo        *string  `json:"gitRepo,omitempty" jsonschema:"Git 仓库地址"`
		Tags           []string `json:"tags,omitempty" jsonschema:"标签（全量替换，注意带上要保留的）；不传则不动标签"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "update_project",
		Description: "编辑项目。只提交要改的字段，其他字段不受影响。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in updateProjectIn) (*mcp.CallToolResult, any, error) {
		body := map[string]any{}
		if in.Name != nil {
			body["name"] = *in.Name
		}
		if in.Kind != nil {
			body["kind"] = *in.Kind
		}
		if in.Status != nil {
			body["status"] = *in.Status
		}
		if in.Summary != nil {
			body["summary"] = *in.Summary
		}
		if in.Quote != nil {
			body["quote"] = *in.Quote
		}
		if in.Cost != nil {
			body["cost"] = *in.Cost
		}
		if in.BillingMode != nil {
			body["billingMode"] = *in.BillingMode
		}
		if in.HourlyRate != nil {
			body["hourlyRate"] = *in.HourlyRate
		}
		if in.CommissionType != nil {
			body["commissionType"] = *in.CommissionType
		}
		if in.CommissionRate != nil {
			body["commissionRate"] = *in.CommissionRate
		}
		if in.Broker != nil {
			body["broker"] = *in.Broker
		}
		if in.StartDate != nil {
			body["startDate"] = *in.StartDate
		}
		if in.DueDate != nil {
			body["dueDate"] = *in.DueDate
		}
		if in.TechStack != nil {
			body["techStack"] = *in.TechStack
		}
		if in.SourcePath != nil {
			body["sourcePath"] = *in.SourcePath
		}
		if in.OnlineURL != nil {
			body["onlineUrl"] = *in.OnlineURL
		}
		if in.AdminURL != nil {
			body["adminUrl"] = *in.AdminURL
		}
		if in.GitRepo != nil {
			body["gitRepo"] = *in.GitRepo
		}
		if in.Tags != nil {
			body["tags"] = in.Tags
		}
		if len(body) == 0 {
			return fail(fmt.Errorf("没有提供任何要修改的字段"))
		}
		var updated map[string]any
		if err := wb.do(ctx, http.MethodPut, fmt.Sprintf("/api/projects/%d", in.ID), body, &updated); err != nil {
			return fail(err)
		}
		return ok(updated)
	})

	type listTasksIn struct {
		ProjectID *uint64 `json:"projectId,omitempty" jsonschema:"只看某个项目下的任务"`
		Status    string  `json:"status,omitempty" jsonschema:"todo 待办 / doing 进行中 / review 待验收 / done 已完成 / canceled 已取消 / archived 已归档；留空：全部"`
		Priority  string  `json:"priority,omitempty" jsonschema:"low 低 / normal 普通 / high 高 / urgent 紧急；留空：全部"`
		Q         string  `json:"q,omitempty" jsonschema:"关键词，匹配标题/描述/备注"`
		Overdue   bool    `json:"overdue,omitempty" jsonschema:"传 true 时只看已逾期未完成的任务"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_tasks",
		Description: "列出任务（含所属项目名、截止日、工时）。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in listTasksIn) (*mcp.CallToolResult, any, error) {
		var page struct {
			Items []taskBrief `json:"items"`
			Total int         `json:"total"`
		}
		pid := ""
		if in.ProjectID != nil {
			pid = fmt.Sprintf("%d", *in.ProjectID)
		}
		overdue := ""
		if in.Overdue {
			overdue = "1"
		}
		url := "/api/tasks?size=200&sort=due&status=" + in.Status + "&priority=" + in.Priority +
			"&q=" + in.Q + "&projectId=" + pid + "&overdue=" + overdue
		if err := wb.do(ctx, http.MethodGet, url, nil, &page); err != nil {
			return fail(err)
		}
		return ok(page)
	})

	type createTaskIn struct {
		Title          string   `json:"title" jsonschema:"任务标题（必填）"`
		Desc           string   `json:"desc,omitempty" jsonschema:"任务描述"`
		AcceptCriteria string   `json:"acceptCriteria,omitempty" jsonschema:"验收标准，一行一条，是任务完成的判定依据；做完了要人工对着逐条验收"`
		ProjectID      *uint64  `json:"projectId,omitempty" jsonschema:"关联项目 ID"`
		Status         string   `json:"status,omitempty" jsonschema:"todo 待办 / doing 进行中 / review 待验收 / done 已完成 / canceled 已取消，默认 todo"`
		Priority       string   `json:"priority,omitempty" jsonschema:"low 低 / normal 普通 / high 高 / urgent 紧急，默认 normal"`
		Kind           string   `json:"kind,omitempty" jsonschema:"company 公司 / personal 个人 / freelance 私活，默认 freelance"`
		DueDate        string   `json:"dueDate,omitempty" jsonschema:"截止日期，如 2026-10-30"`
		Budget         *float64 `json:"budget,omitempty" jsonschema:"预算"`
		Note           string   `json:"note,omitempty" jsonschema:"备注"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_task",
		Description: "创建任务。建议写清 acceptCriteria（验收标准），完成后由人工逐条验收。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createTaskIn) (*mcp.CallToolResult, any, error) {
		var created map[string]any
		if err := wb.do(ctx, http.MethodPost, "/api/tasks", in, &created); err != nil {
			return fail(err)
		}
		return ok(created)
	})

	type listTicketsIn struct {
		Status    string  `json:"status,omitempty" jsonschema:"pending 待处理 / doing 处理中 / waiting 待客户确认 / closed 已关闭；留空：全部"`
		ProjectID *uint64 `json:"projectId,omitempty" jsonschema:"只看某个项目下的工单"`
		Q         string  `json:"q,omitempty" jsonschema:"关键词，匹配标题/描述/反馈人；也可以直接填工单号，如 WT-000012"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_tickets",
		Description: "列出客户工单（含工单号、所属项目、当前阶段、打回轮次）。想知道有哪些工单待处理先调它。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in listTicketsIn) (*mcp.CallToolResult, any, error) {
		url := "/api/tickets?size=200&status=" + in.Status + "&q=" + in.Q
		if in.ProjectID != nil {
			url += fmt.Sprintf("&projectId=%d", *in.ProjectID)
		}
		var page struct {
			Items []ticketBrief `json:"items"`
			Total int           `json:"total"`
		}
		if err := wb.do(ctx, http.MethodGet, url, nil, &page); err != nil {
			return fail(err)
		}
		return ok(page)
	})

	type getTicketIn struct {
		ID uint64 `json:"id,omitempty" jsonschema:"工单 ID"`
		No string `json:"no,omitempty" jsonschema:"工单号，如 WT-000012；不知道 ID 时用它"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_ticket",
		Description: "查看工单详情：问题描述、期望效果、页面地址、全部沟通记录和截图。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in getTicketIn) (*mcp.CallToolResult, any, error) {
		id, err := ticketRef(in.ID, in.No)
		if err != nil {
			return fail(err)
		}
		var detail map[string]any
		if err := wb.do(ctx, http.MethodGet, fmt.Sprintf("/api/tickets/%d", id), nil, &detail); err != nil {
			return fail(err)
		}
		return ok(detail)
	})

	type createTicketIn struct {
		ProjectID uint64 `json:"projectId" jsonschema:"所属项目 ID（必填，先用 list_projects 查）"`
		Title     string `json:"title" jsonschema:"问题标题（必填）"`
		Desc      string `json:"desc,omitempty" jsonschema:"客户原话：遇到什么问题、在什么操作下出现"`
		Expect    string `json:"expect,omitempty" jsonschema:"期望效果：客户认为做到什么程度算解决"`
		PageURL   string `json:"pageUrl,omitempty" jsonschema:"出问题的具体页面地址"`
		Reporter  string `json:"reporter,omitempty" jsonschema:"反馈人姓名"`
		Contact   string `json:"contact,omitempty" jsonschema:"联系方式（手机/微信/邮箱）"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_ticket",
		Description: "代客户录入工单。客户通过微信/邮件私下反馈问题时用：把客户原话整理成 title/desc/expect，并尽量补上 reporter 和 contact。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createTicketIn) (*mcp.CallToolResult, any, error) {
		var created map[string]any
		if err := wb.do(ctx, http.MethodPost, "/api/tickets", in, &created); err != nil {
			return fail(err)
		}
		return ok(created)
	})

	type updateTicketIn struct {
		ID         uint64  `json:"id,omitempty" jsonschema:"工单 ID"`
		No         string  `json:"no,omitempty" jsonschema:"工单号，如 WT-000012"`
		Status     *string `json:"status,omitempty" jsonschema:"推进阶段：pending 待处理 / doing 处理中 / waiting 待客户确认。不能设为 closed，结案由人工或客户确认"`
		Message    string  `json:"message,omitempty" jsonschema:"要追加的一条沟通记录"`
		Visibility *string `json:"visibility,omitempty" jsonschema:"public 客户可见 / internal 仅内部备注，默认 internal"`
		CloseNote  string  `json:"closeNote,omitempty" jsonschema:"结案说明（仅在页面上结案时填写）"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "update_ticket",
		Description: "推进工单：改阶段、追加沟通记录。AI 最多推进到 waiting（待客户确认）；closed 只能由人工在页面结案或客户自己确认。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in updateTicketIn) (*mcp.CallToolResult, any, error) {
		id, err := ticketRef(in.ID, in.No)
		if err != nil {
			return fail(err)
		}
		body := map[string]any{}
		if in.Status != nil {
			if *in.Status == "closed" {
				return fail(fmt.Errorf("AI 不能直接结案：请把状态改为 waiting 交给客户确认，或由人工在工单页面结案"))
			}
			body["status"] = *in.Status
		}
		if in.Message != "" {
			body["message"] = in.Message
			vis := "internal"
			if in.Visibility != nil && *in.Visibility == "public" {
				vis = "public"
			}
			body["visibility"] = vis
		}
		if in.CloseNote != "" {
			body["closeNote"] = in.CloseNote
		}
		if len(body) == 0 {
			return fail(fmt.Errorf("没有提供任何要修改的字段"))
		}
		var updated map[string]any
		if err := wb.do(ctx, http.MethodPut, fmt.Sprintf("/api/tickets/%d", id), body, &updated); err != nil {
			return fail(err)
		}
		return ok(updated)
	})

	type listRemindersIn struct {
		Category  string  `json:"category,omitempty" jsonschema:"certificate 证书 / domain 域名 / server 服务器 / client 客户续费 / other 其他；留空：全部"`
		ProjectID *uint64 `json:"projectId,omitempty" jsonschema:"只看某个项目下的提醒"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_reminders",
		Description: "列出到期提醒（证书、域名、服务器、客户续费），含到期日、剩余天数、是否已过期。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in listRemindersIn) (*mcp.CallToolResult, any, error) {
		url := "/api/reminders?category=" + in.Category
		if in.ProjectID != nil {
			url += fmt.Sprintf("&projectId=%d", *in.ProjectID)
		}
		var out struct {
			Items []reminderBrief `json:"items"`
		}
		if err := wb.do(ctx, http.MethodGet, url, nil, &out); err != nil {
			return fail(err)
		}
		return ok(out)
	})

	type createReminderIn struct {
		Title      string  `json:"title" jsonschema:"提醒名称（必填）"`
		Category   string  `json:"category,omitempty" jsonschema:"certificate 证书 / domain 域名 / server 服务器 / client 客户续费 / other 其他，默认 other"`
		ProjectID  *uint64 `json:"projectId,omitempty" jsonschema:"关联项目 ID"`
		Target     string  `json:"target,omitempty" jsonschema:"域名 / 主机 / 说明"`
		ExpireAt   string  `json:"expireAt" jsonschema:"到期日，如 2026-11-30（必填）"`
		RemindDays int     `json:"remindDays,omitempty" jsonschema:"提前多少天开始提醒，默认 7"`
		Issuer     string  `json:"issuer,omitempty" jsonschema:"签发机构 / 服务商"`
		AutoRenew  bool    `json:"autoRenew,omitempty" jsonschema:"是否自动续费"`
		Note       string  `json:"note,omitempty" jsonschema:"备注"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_reminder",
		Description: "新建到期提醒。进入提前提醒天数或已过期后，工作台会按配置发送邮件通知。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createReminderIn) (*mcp.CallToolResult, any, error) {
		var created map[string]any
		if err := wb.do(ctx, http.MethodPost, "/api/reminders", in, &created); err != nil {
			return fail(err)
		}
		return ok(created)
	})

	// get_task_attachments：把任务上的截图以图片内容返回给 AI（多模态模型可直接看图）。
	// 打回验收流程里，人工常会贴截图说明问题——AI 处理打回时靠这个工具看图修活。
	const (
		maxAttachmentsPerCall = 8       // 最多返回几张图，防止单次调用撑爆上下文
		maxAttachmentBytes    = 5 << 20 // 单张超过 5MB 跳过并说明
	)

	type getTaskAttachmentsIn struct {
		TaskID uint64 `json:"taskId" jsonschema:"任务 ID（必填）"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_task_attachments",
		Description: "读取任务上的截图/图片，以图片形式返回，能直接看图。处理打回、验收前先看现场截图时用。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in getTaskAttachmentsIn) (*mcp.CallToolResult, any, error) {
		var list struct {
			Items []attMeta `json:"items"`
		}
		if err := wb.do(ctx, http.MethodGet,
			fmt.Sprintf("/api/attachments?taskId=%d&size=50", in.TaskID), nil, &list); err != nil {
			return fail(err)
		}
		if len(list.Items) == 0 {
			return ok("该任务没有图片附件")
		}
		res := &mcp.CallToolResult{}
		summary := fmt.Sprintf("共 %d 张图片", len(list.Items))
		for i, a := range list.Items {
			if i >= maxAttachmentsPerCall {
				summary += fmt.Sprintf("；其余 %d 张超出单次上限，请按附件 ID 分批获取", len(list.Items)-maxAttachmentsPerCall)
				break
			}
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, wb.base+a.URL, nil)
			if err != nil {
				return fail(err)
			}
			resp, err := wb.http.Do(req)
			if err != nil {
				return fail(fmt.Errorf("拉取附件 %s 失败: %w", a.Name, err))
			}
			b, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				return fail(fmt.Errorf("读取附件 %s 失败: %w", a.Name, err))
			}
			if resp.StatusCode >= 300 {
				summary += fmt.Sprintf("；%s 拉取失败(HTTP %d)", a.Name, resp.StatusCode)
				continue
			}
			if len(b) > maxAttachmentBytes {
				summary += fmt.Sprintf("；%s 超过 5MB 已跳过", a.Name)
				continue
			}
			res.Content = append(res.Content, &mcp.ImageContent{
				Data:     b, // SDK 序列化时自动 base64
				MIMEType: a.Mime,
			})
		}
		res.Content = append([]mcp.Content{&mcp.TextContent{Text: summary}}, res.Content...)
		return res, nil, nil
	})

	type updateTaskIn struct {
		ID             uint64   `json:"id" jsonschema:"任务 ID（必填，先用 list_tasks 查）"`
		Title          *string  `json:"title,omitempty" jsonschema:"任务标题"`
		Desc           *string  `json:"desc,omitempty" jsonschema:"任务描述"`
		AcceptCriteria *string  `json:"acceptCriteria,omitempty" jsonschema:"验收标准，一行一条"`
		Status         *string  `json:"status,omitempty" jsonschema:"todo 待办 / doing 进行中 / review 待验收；done、canceled、archived 由人工在网页设置，本工具不接受"`
		Priority       *string  `json:"priority,omitempty" jsonschema:"low / normal / high / urgent"`
		ProjectID      *uint64  `json:"projectId,omitempty" jsonschema:"改关联的项目"`
		DueDate        *string  `json:"dueDate,omitempty" jsonschema:"截止日期；传空字符串清除"`
		Budget         *float64 `json:"budget,omitempty" jsonschema:"预算"`
		Note           *string  `json:"note,omitempty" jsonschema:"备注"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name: "update_task",
		Description: "编辑任务。AI 完成工作后：把状态流转到 review（待验收），并在 note 里逐条写明" +
			"验收标准的自检结果，等人工在网页上实测验收；done / canceled / archived 一律由人工设置，本工具不接受。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in updateTaskIn) (*mcp.CallToolResult, any, error) {
		body := map[string]any{}
		if in.Title != nil {
			body["title"] = *in.Title
		}
		if in.Desc != nil {
			body["desc"] = *in.Desc
		}
		if in.AcceptCriteria != nil {
			body["acceptCriteria"] = *in.AcceptCriteria
		}
		if in.Status != nil {
			// 硬约束：AI 不能宣布任务完成。done/canceled/archived 是人工验收和整理动作，
			// 只能人在网页上点，避免 AI 自检通过就直接抹掉「待验收」环节。
			if *in.Status == "done" || *in.Status == "canceled" || *in.Status == "archived" {
				return fail(fmt.Errorf(
					"任务状态不能由 AI 设为 %s：请把工作成果留好，状态流转到 review（待验收），并在 note 里逐条写明验收标准的自检结果，由人工验收后设置", *in.Status))
			}
			body["status"] = *in.Status
		}
		if in.Priority != nil {
			body["priority"] = *in.Priority
		}
		if in.ProjectID != nil {
			body["projectId"] = *in.ProjectID
		}
		if in.DueDate != nil {
			body["dueDate"] = *in.DueDate
		}
		if in.Budget != nil {
			body["budget"] = *in.Budget
		}
		if in.Note != nil {
			body["note"] = *in.Note
		}
		if len(body) == 0 {
			return fail(fmt.Errorf("没有提供任何要修改的字段"))
		}
		var updated map[string]any
		if err := wb.do(ctx, http.MethodPut, fmt.Sprintf("/api/tasks/%d", in.ID), body, &updated); err != nil {
			return fail(err)
		}
		return ok(updated)
	})

	type listWorkLogsIn struct {
		ProjectID uint64 `json:"projectId" jsonschema:"项目 ID（必填，先用 list_projects 查）"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_work_logs",
		Description: "列出某个项目的工时记录（日期、工时、工作内容），按日期倒序。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in listWorkLogsIn) (*mcp.CallToolResult, any, error) {
		var out struct {
			Items []workLogBrief `json:"items"`
			Total int            `json:"total"`
		}
		if err := wb.do(ctx, http.MethodGet,
			fmt.Sprintf("/api/projects/%d/worklogs", in.ProjectID), nil, &out); err != nil {
			return fail(err)
		}
		out.Total = len(out.Items)
		return ok(out)
	})

	type createWorkLogIn struct {
		ProjectID uint64  `json:"projectId" jsonschema:"项目 ID（必填，必须是按工时计费的项目）"`
		Hours     float64 `json:"hours" jsonschema:"本次工时（小时，支持小数，如 1.5）"`
		Content   string  `json:"content" jsonschema:"工作内容（必填），写清这次干了什么"`
		WorkDate  string  `json:"workDate,omitempty" jsonschema:"工作日期，如 2026-10-29；留空：今天"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name: "create_work_log",
		Description: "记录一次工时。按工时计费的项目会自动按「累计工时 × 时薪」更新应结金额。" +
			"AI 干完一段时间工作后用这个工具记一笔。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createWorkLogIn) (*mcp.CallToolResult, any, error) {
		content := strings.TrimSpace(in.Content)
		if content == "" {
			return fail(fmt.Errorf("工作内容必填"))
		}
		if in.Hours <= 0 {
			return fail(fmt.Errorf("工时必须大于 0"))
		}
		body := map[string]any{
			"minutes": int(math.Round(in.Hours * 60)),
			"content": content,
		}
		if in.WorkDate != "" {
			body["workDate"] = in.WorkDate
		}
		var created map[string]any
		if err := wb.do(ctx, http.MethodPost,
			fmt.Sprintf("/api/projects/%d/worklogs", in.ProjectID), body, &created); err != nil {
			return fail(err)
		}
		return ok(created)
	})

	type updateWorkLogIn struct {
		ID       uint64   `json:"id" jsonschema:"工时记录 ID（必填，先用 list_work_logs 查）"`
		Hours    *float64 `json:"hours,omitempty" jsonschema:"改成多少小时"`
		Content  *string  `json:"content,omitempty" jsonschema:"修改工作内容"`
		WorkDate *string  `json:"workDate,omitempty" jsonschema:"修改日期，如 2026-10-29"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "update_work_log",
		Description: "修改一条工时记录。只提交要改的字段。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in updateWorkLogIn) (*mcp.CallToolResult, any, error) {
		body := map[string]any{}
		if in.Hours != nil {
			if *in.Hours <= 0 {
				return fail(fmt.Errorf("工时必须大于 0"))
			}
			body["minutes"] = int(math.Round(*in.Hours * 60))
		}
		if in.Content != nil {
			content := strings.TrimSpace(*in.Content)
			if content == "" {
				return fail(fmt.Errorf("工作内容必填"))
			}
			body["content"] = content
		}
		if in.WorkDate != nil {
			body["workDate"] = *in.WorkDate
		}
		if len(body) == 0 {
			return fail(fmt.Errorf("没有提供任何要修改的字段"))
		}
		var updated map[string]any
		if err := wb.do(ctx, http.MethodPut, fmt.Sprintf("/api/worklogs/%d", in.ID), body, &updated); err != nil {
			return fail(err)
		}
		return ok(updated)
	})

	type searchContentsIn struct {
		Q         string `json:"q,omitempty" jsonschema:"关键词，匹配标题、正文和标签；留空则按更新时间列最新内容"`
		Kind      string `json:"kind,omitempty" jsonschema:"类型：pitfall 经验避坑 / article 文章草稿 / client 客户素材 / note 笔记；留空：全部"`
		Status    string `json:"status,omitempty" jsonschema:"状态：draft 草稿 / ready 待发 / published 已发布 / archived 已归档；留空：全部"`
		ProjectID uint64 `json:"projectId,omitempty" jsonschema:"只查关联到该项目的内容"`
		ClientID  uint64 `json:"clientId,omitempty" jsonschema:"只查关联到该客户的内容"`
		Limit     int    `json:"limit,omitempty" jsonschema:"返回条数，默认 20，最多 50"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "search_contents",
		Description: "检索内容库（经验避坑、文章草稿、客户素材、笔记）。先按关键词搜索，拿到 id 再用 get_content 读全文。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in searchContentsIn) (*mcp.CallToolResult, any, error) {
		limit := in.Limit
		if limit <= 0 {
			limit = 20
		}
		if limit > 50 {
			limit = 50
		}
		params := url.Values{}
		params.Set("size", strconv.Itoa(limit))
		if in.Q != "" {
			params.Set("q", in.Q)
		}
		if in.Kind != "" {
			params.Set("kind", in.Kind)
		}
		if in.Status != "" {
			params.Set("status", in.Status)
		}
		if in.ProjectID > 0 {
			params.Set("projectId", strconv.FormatUint(in.ProjectID, 10))
		}
		if in.ClientID > 0 {
			params.Set("clientId", strconv.FormatUint(in.ClientID, 10))
		}
		var page struct {
			Items []contentBrief `json:"items"`
			Total int            `json:"total"`
		}
		if err := wb.do(ctx, http.MethodGet, "/api/contents?"+params.Encode(), nil, &page); err != nil {
			return fail(err)
		}
		if page.Items == nil {
			page.Items = []contentBrief{}
		}
		return ok(page)
	})

	type getContentIn struct {
		ID uint64 `json:"id" jsonschema:"内容 ID（先用 search_contents 查）"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_content",
		Description: "读取一篇内容的完整正文和元数据，用于总结、引用或继续整理。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in getContentIn) (*mcp.CallToolResult, any, error) {
		var detail contentDetail
		if err := wb.do(ctx, http.MethodGet, fmt.Sprintf("/api/contents/%d", in.ID), nil, &detail); err != nil {
			return fail(err)
		}
		return ok(detail)
	})

	type updateContentIn struct {
		ID        uint64   `json:"id" jsonschema:"内容 ID（必填，先用 search_contents 查）"`
		Title     *string  `json:"title,omitempty" jsonschema:"新标题；省略：不改"`
		Kind      *string  `json:"kind,omitempty" jsonschema:"新类型：pitfall 经验避坑 / article 文章草稿 / client 客户素材 / note 笔记；省略：不改"`
		Status    *string  `json:"status,omitempty" jsonschema:"新状态：draft 草稿 / ready 待发 / published 已发布 / archived 已归档；省略：不改"`
		Body      *string  `json:"body,omitempty" jsonschema:"新的完整 Markdown 正文，会整篇覆盖；省略：不改"`
		Tags      []string `json:"tags,omitempty" jsonschema:"新的标签列表；省略：不改，传空数组：清空"`
		ProjectID *uint64  `json:"projectId,omitempty" jsonschema:"关联项目 ID；省略：不改，0：取消关联"`
		ClientID  *uint64  `json:"clientId,omitempty" jsonschema:"关联客户 ID；省略：不改，0：取消关联"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name: "update_content",
		Description: "修改一篇内容，只提交要改的字段。" +
			"改正文前先 get_content 拿到全文，提交完整的新正文；这个工具没有版本历史，整篇覆盖后无法撤销。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in updateContentIn) (*mcp.CallToolResult, any, error) {
		var cur contentDetail
		if err := wb.do(ctx, http.MethodGet, fmt.Sprintf("/api/contents/%d", in.ID), nil, &cur); err != nil {
			return fail(err)
		}
		payload := map[string]any{
			"title": cur.Title, "kind": cur.Kind, "status": cur.Status,
			"body": cur.Body, "tags": cur.Tags,
			"projectId": cur.ProjectID, "clientId": cur.ClientID,
		}
		if in.Title != nil {
			title := strings.TrimSpace(*in.Title)
			if title == "" {
				return fail(fmt.Errorf("标题不能为空"))
			}
			payload["title"] = title
		}
		if in.Kind != nil {
			payload["kind"] = *in.Kind
		}
		if in.Status != nil {
			payload["status"] = *in.Status
		}
		if in.Body != nil {
			payload["body"] = *in.Body
		}
		if in.Tags != nil {
			payload["tags"] = strings.Join(in.Tags, ",")
		}
		if in.ProjectID != nil {
			if *in.ProjectID == 0 {
				payload["projectId"] = nil
			} else {
				payload["projectId"] = *in.ProjectID
			}
		}
		if in.ClientID != nil {
			if *in.ClientID == 0 {
				payload["clientId"] = nil
			} else {
				payload["clientId"] = *in.ClientID
			}
		}
		var updated contentDetail
		if err := wb.do(ctx, http.MethodPut, fmt.Sprintf("/api/contents/%d", in.ID), payload, &updated); err != nil {
			return fail(err)
		}
		return ok(updated)
	})

	type editContentIn struct {
		ID         uint64 `json:"id" jsonschema:"内容 ID（必填，先用 search_contents 查）"`
		OldText    string `json:"oldText" jsonschema:"要被替换的原文片段，必须从 get_content 的正文里逐字复制"`
		NewText    string `json:"newText" jsonschema:"替换后的新片段；传空字符串表示删除这段"`
		ReplaceAll bool   `json:"replaceAll,omitempty" jsonschema:"原文出现多处时是否全部替换，默认 false（只允许唯一匹配）"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name: "edit_content",
		Description: "按原文片段精确替换正文，只改局部，不用重写整篇。" +
			"oldText 必须从 get_content 的正文逐字复制；默认要求唯一匹配，匹配到多处会失败并提示，可补充上下文或传 replaceAll=true。" +
			"改标题、标签、状态用 update_content。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in editContentIn) (*mcp.CallToolResult, any, error) {
		if in.OldText == "" {
			return fail(fmt.Errorf("oldText 不能为空"))
		}
		var cur contentDetail
		if err := wb.do(ctx, http.MethodGet, fmt.Sprintf("/api/contents/%d", in.ID), nil, &cur); err != nil {
			return fail(err)
		}
		count := strings.Count(cur.Body, in.OldText)
		if count == 0 {
			return fail(fmt.Errorf("正文里找不到 oldText，先用 get_content 确认原文"))
		}
		if count > 1 && !in.ReplaceAll {
			return fail(fmt.Errorf("oldText 匹配到 %d 处，请补充上下文让它唯一，或传 replaceAll=true", count))
		}
		replacements := uint64(1)
		limit := 1
		if in.ReplaceAll {
			replacements = uint64(count)
			limit = -1
		}
		payload := map[string]any{
			"title": cur.Title, "kind": cur.Kind, "status": cur.Status,
			"body": strings.Replace(cur.Body, in.OldText, in.NewText, limit),
			"tags": cur.Tags, "projectId": cur.ProjectID, "clientId": cur.ClientID,
		}
		var updated contentDetail
		if err := wb.do(ctx, http.MethodPut, fmt.Sprintf("/api/contents/%d", in.ID), payload, &updated); err != nil {
			return fail(err)
		}
		return ok(map[string]any{
			"id": updated.ID, "replacements": replacements, "updatedAt": updated.UpdatedAt,
		})
	})

	type createContentIn struct {
		Title     string   `json:"title" jsonschema:"标题（必填）"`
		Body      string   `json:"body,omitempty" jsonschema:"Markdown 正文"`
		Kind      string   `json:"kind,omitempty" jsonschema:"类型：pitfall 经验避坑 / article 文章草稿 / client 客户素材 / note 笔记，默认 note"`
		Status    string   `json:"status,omitempty" jsonschema:"状态：draft 草稿 / ready 待发 / published 已发布 / archived 已归档，默认 draft"`
		Tags      []string `json:"tags,omitempty" jsonschema:"标签，最多 10 个"`
		ProjectID uint64   `json:"projectId,omitempty" jsonschema:"关联项目 ID；0：不关联"`
		ClientID  uint64   `json:"clientId,omitempty" jsonschema:"关联客户 ID；0：不关联"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_content",
		Description: "在内容库新建一篇内容，用于把整理好的结论或总结保存下来。",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createContentIn) (*mcp.CallToolResult, any, error) {
		payload := map[string]any{
			"title": in.Title,
			"body":  in.Body,
			"tags":  strings.Join(in.Tags, ","),
		}
		if in.Kind != "" {
			payload["kind"] = in.Kind
		}
		if in.Status != "" {
			payload["status"] = in.Status
		}
		if in.ProjectID > 0 {
			payload["projectId"] = in.ProjectID
		}
		if in.ClientID > 0 {
			payload["clientId"] = in.ClientID
		}
		var created contentDetail
		if err := wb.do(ctx, http.MethodPost, "/api/contents", payload, &created); err != nil {
			return fail(err)
		}
		return ok(created)
	})
}

// ---------- API 返回的裁剪视图 ----------

type contentBrief struct {
	ID              uint64   `json:"id"`
	Title           string   `json:"title"`
	Kind            string   `json:"kind"`
	Status          string   `json:"status"`
	TagList         []string `json:"tagList"`
	Excerpt         string   `json:"excerpt"`
	ProjectID       *uint64  `json:"projectId,omitempty"`
	ProjectName     string   `json:"projectName,omitempty"`
	ClientID        *uint64  `json:"clientId,omitempty"`
	ClientName      string   `json:"clientName,omitempty"`
	AttachmentCount int      `json:"attachmentCount,omitempty"`
	UpdatedAt       string   `json:"updatedAt"`
}

type contentDetail struct {
	contentBrief
	Body            string `json:"body"`
	Tags            string `json:"tags"`
	SourceIdeaTitle string `json:"sourceIdeaTitle,omitempty"`
	CreatedAt       string `json:"createdAt"`
}

type projectBrief struct {
	ID            uint64   `json:"id"`
	Name          string   `json:"name"`
	Kind          string   `json:"kind"`
	Status        string   `json:"status"`
	Summary       string   `json:"summary,omitempty"`
	Quote         float64  `json:"quote"`
	NetQuote      float64  `json:"netQuote"`
	Received      float64  `json:"received"`
	BillingMode   string   `json:"billingMode,omitempty"`
	HourlyRate    float64  `json:"hourlyRate,omitempty"`
	ActualMinutes int      `json:"actualMinutes,omitempty"`
	StartDate     *string  `json:"startDate,omitempty"`
	DueDate       *string  `json:"dueDate,omitempty"`
	TechStack     string   `json:"techStack,omitempty"`
	Tags          []string `json:"tags,omitempty"`
}

type workLogBrief struct {
	ID        uint64 `json:"id"`
	ProjectID uint64 `json:"projectId"`
	WorkDate  string `json:"workDate"`
	Minutes   int    `json:"minutes"`
	Content   string `json:"content"`
}

type taskBrief struct {
	ID              uint64  `json:"id"`
	No              string  `json:"no,omitempty"`
	Title           string  `json:"title"`
	Desc            string  `json:"desc,omitempty"`
	AcceptCriteria  string  `json:"acceptCriteria,omitempty"`
	Status          string  `json:"status"`
	Priority        string  `json:"priority"`
	ProjectID       *uint64 `json:"projectId,omitempty"`
	ProjectName     string  `json:"projectName,omitempty"`
	DueDate         *string `json:"dueDate,omitempty"`
	DueState        string  `json:"dueState,omitempty"`
	EstimateMinutes int     `json:"estimateMinutes,omitempty"`
	ActualMinutes   int     `json:"actualMinutes,omitempty"`
	Note            string  `json:"note,omitempty"`
}

// ticketBrief 工单列表的裁剪视图（对应 /api/tickets 的返回）
type ticketBrief struct {
	ID           uint64 `json:"id"`
	No           string `json:"no"`
	ProjectID    uint64 `json:"projectId"`
	ProjectName  string `json:"projectName,omitempty"`
	ClientName   string `json:"clientName,omitempty"`
	Title        string `json:"title"`
	Status       string `json:"status"`
	Round        int    `json:"round"`
	Reporter     string `json:"reporter,omitempty"`
	Contact      string `json:"contact,omitempty"`
	PageURL      string `json:"pageUrl,omitempty"`
	AccessPath   string `json:"accessPath,omitempty"`
	MessageCount int    `json:"messageCount"`
	UpdatedAt    string `json:"updatedAt"`
}

// ticketRef 让 AI 既可以用 ID 也可以用「WT-000012」这种编号定位工单。
func ticketRef(id uint64, no string) (uint64, error) {
	if id > 0 {
		return id, nil
	}
	s := strings.ToUpper(strings.TrimSpace(no))
	s = strings.TrimPrefix(s, "WT-")
	s = strings.TrimPrefix(s, "#")
	if s == "" {
		return 0, fmt.Errorf("需要提供工单 id 或工单号（如 WT-000012）")
	}
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil || v == 0 {
		return 0, fmt.Errorf("工单号格式不对：%s", no)
	}
	return v, nil
}

// reminderBrief 提醒列表的裁剪视图（对应 /api/reminders 的返回）
type reminderBrief struct {
	ID          uint64  `json:"id"`
	Title       string  `json:"title"`
	Category    string  `json:"category"`
	ProjectID   *uint64 `json:"projectId,omitempty"`
	ProjectName string  `json:"projectName,omitempty"`
	Target      string  `json:"target,omitempty"`
	ExpireAt    string  `json:"expireAt"`
	RemindDays  int     `json:"remindDays"`
	Issuer      string  `json:"issuer,omitempty"`
	AutoRenew   bool    `json:"autoRenew"`
	Enabled     bool    `json:"enabled"`
	Note        string  `json:"note,omitempty"`
	State       string  `json:"state,omitempty"`
	DaysLeft    int     `json:"daysLeft"`
}

// attMeta 附件列表的裁剪视图（对应 /api/attachments 的返回）
type attMeta struct {
	ID     uint64 `json:"id"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	Mime   string `json:"mime"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Size   int64  `json:"size"`
}

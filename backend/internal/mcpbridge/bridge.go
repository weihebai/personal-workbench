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
	"net/http"
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
		base:  strings.TrimRight(base, "/"),
		user:  user,
		pass:  pass,
		http:  &http.Client{Timeout: 15 * time.Second},
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
		Status string `json:"status,omitempty" jsonschema:"按状态过滤，多个用英文逗号分隔：negotiating 洽谈中 / active 进行中 / delivered 已交付 / paid 已结款 / paused 已暂停 / archived 已归档；留空=全部"`
		Kind   string `json:"kind,omitempty" jsonschema:"按类型过滤：company 公司项目 / outsource 外包私活 / personal 个人项目；留空=全部"`
		Q      string `json:"q,omitempty" jsonschema:"关键词，匹配项目名/简介/技术栈/网址"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_projects",
		Description: "列出工作台的项目（含合同额、已收、抽成等汇总）。想改项目先从这里拿 id。",
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
		Description: "查看项目详情：基本信息、收款记录、任务、里程碑。",
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
		Quote          float64  `json:"quote,omitempty" jsonschema:"合同/报价总额"`
		Cost           float64  `json:"cost,omitempty" jsonschema:"成本（服务器/第三方等）"`
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
		Quote          *float64 `json:"quote,omitempty" jsonschema:"合同/报价总额"`
		Cost           *float64 `json:"cost,omitempty" jsonschema:"成本"`
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
		Status    string  `json:"status,omitempty" jsonschema:"todo 待办 / doing 进行中 / done 已完成 / canceled 已取消；留空=全部"`
		Priority  string  `json:"priority,omitempty" jsonschema:"low 低 / normal 普通 / high 高 / urgent 紧急；留空=全部"`
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
		Kind           string   `json:"kind,omitempty" jsonschema:"personal 个人 / freelance 私活，默认 freelance"`
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

// get_task_attachments：把任务上的截图以图片内容返回给 AI（多模态模型可直接看图）。
// 打回验收流程里，人工常会贴截图说明问题——AI 处理打回时靠这个工具看图修活。
const (
	maxAttachmentsPerCall = 8  // 最多返回几张图，防止单次调用撑爆上下文
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
		Status         *string  `json:"status,omitempty" jsonschema:"todo 待办 / doing 进行中 / review 待验收；done 与 canceled 由人工验收后在网页设置，本工具不接受"`
		Priority       *string  `json:"priority,omitempty" jsonschema:"low / normal / high / urgent"`
		ProjectID      *uint64  `json:"projectId,omitempty" jsonschema:"改关联的项目"`
		DueDate        *string  `json:"dueDate,omitempty" jsonschema:"截止日期；传空字符串清除"`
		Budget         *float64 `json:"budget,omitempty" jsonschema:"预算"`
		Note           *string  `json:"note,omitempty" jsonschema:"备注"`
	}
	mcp.AddTool(server, &mcp.Tool{
		Name: "update_task",
		Description: "编辑任务。AI 完成工作后：把状态流转到 review（待验收），并在 note 里逐条写明" +
			"验收标准的自检结果，等人工在网页上实测验收；done / canceled 一律由人工设置，本工具不接受。",
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
			// 硬约束：AI 不能宣布任务完成。done/canceled 是人工验收动作，
			// 只能人在网页上点，避免 AI 自检通过就直接抹掉「待验收」环节。
			if *in.Status == "done" || *in.Status == "canceled" {
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
}

// ---------- API 返回的裁剪视图 ----------

type projectBrief struct {
	ID        uint64   `json:"id"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Status    string   `json:"status"`
	Summary   string   `json:"summary,omitempty"`
	Quote     float64  `json:"quote"`
	NetQuote  float64  `json:"netQuote"`
	Received  float64  `json:"received"`
	StartDate *string  `json:"startDate,omitempty"`
	DueDate   *string  `json:"dueDate,omitempty"`
	TechStack string   `json:"techStack,omitempty"`
	Tags      []string `json:"tags,omitempty"`
}

type taskBrief struct {
	ID              uint64  `json:"id"`
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

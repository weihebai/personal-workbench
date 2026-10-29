package model

import (
	"time"

	"gorm.io/gorm"
)

// 基础字段：所有业务表统一软删除 + 时间戳
type Base struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type User struct {
	Base
	Username     string `gorm:"size:64;uniqueIndex;not null" json:"username"`
	PasswordHash string `gorm:"size:255;not null" json:"-"`
	Nickname     string `gorm:"size:64" json:"nickname"`
	Avatar       string `gorm:"size:255" json:"avatar"`
	// TokenVersion 写入 JWT；登出时自增，让已签发的 token 立即失效。
	// 老 token 没有 ver 字段时按 0 处理，与初始版本一致，升级不会踢人。
	TokenVersion int `gorm:"not null;default:0" json:"-"`
}

// LoginAttempt 登录失败限流记录。落库而不是放内存：
// 重启后锁定仍然有效，多个进程也共享同一份计数。
type LoginAttempt struct {
	Key         string     `gorm:"primarykey;size:128" json:"-"`
	Failures    int        `gorm:"not null;default:0" json:"-"`
	LockedUntil *time.Time `json:"-"`
	UpdatedAt   time.Time  `json:"-"`
}

// 客户（外包甲方 / 渠道方）
type Client struct {
	Base
	Name    string `gorm:"size:128;not null" json:"name"`
	Contact string `gorm:"size:64" json:"contact"`
	Phone   string `gorm:"size:32" json:"phone"`
	Wechat  string `gorm:"size:64" json:"wechat"`
	Source  string `gorm:"size:32" json:"source"` // 闲鱼/小红书/熟人/其他
	Note    string `gorm:"type:text" json:"note"`
}

// 项目
type Project struct {
	Base
	Name    string `gorm:"size:128;not null;index" json:"name"`
	Kind    string `gorm:"size:16;index" json:"kind"`   // company 公司 / outsource 外包 / personal 个人
	Status  string `gorm:"size:24;index" json:"status"` // negotiating 洽谈中 / active 进行中 / delivered 已交付 / paid 已结款 / paused 已暂停 / archived 已归档
	Summary string `gorm:"type:text" json:"summary"`

	// 资产索引（借鉴 ProjectVault）
	SourcePath string `gorm:"size:512" json:"sourcePath"` // 本地源码目录
	OnlineURL  string `gorm:"size:512" json:"onlineUrl"`  // 线上网址
	AdminURL   string `gorm:"size:512" json:"adminUrl"`   // 管理后台
	GitRepo    string `gorm:"size:512" json:"gitRepo"`    // Git 仓库
	DeployAt   string `gorm:"size:255" json:"deployAt"`   // 部署位置（服务器/云服务商）
	TechStack  string `gorm:"size:255" json:"techStack"`

	// 财务
	ClientID  *uint   `gorm:"index" json:"clientId"`
	Quote     float64 `json:"quote"` // 合同/报价总额（客户付的全款）
	Cost      float64 `json:"cost"`  // 成本（服务器/第三方等）
	// 中介抽成：CommissionType=pct 时 CommissionRate 是百分比（20 = 抽 20%），
	// CommissionType=fixed 时 CommissionRate 是固定金额。
	// 抽成从合同额里扣，记录收款时填实际到账（扣完抽成的钱）。
	CommissionType string  `gorm:"size:16" json:"commissionType"` // none 无 / pct 按比例 / fixed 固定金额
	CommissionRate float64 `json:"commissionRate"`
	Broker         string  `gorm:"size:128" json:"broker"` // 中介/渠道名，如「XX接单群」
	StartDate *time.Time `json:"startDate"`
	DueDate   *time.Time `json:"dueDate"`

	// 工时（分钟）
	EstimateMinutes int `json:"estimateMinutes"`
	ActualMinutes   int `json:"actualMinutes"`

	Note string `gorm:"type:text" json:"note"`

	// 只读聚合字段（查询时填充，不落库）
	Received float64  `gorm:"-" json:"received"`
	TagList  []string `gorm:"-" json:"tags"`

	// 抽成与净收入（只读，由 Quote/CommissionType/CommissionRate 推算）
	Commission float64 `gorm:"-" json:"commission"` // 抽成金额
	NetQuote   float64 `gorm:"-" json:"netQuote"`   // 扣完抽成你应得的合同额

	// 里程碑进度（列表卡片展示）
	MilestoneTotal int    `gorm:"-" json:"milestoneTotal"`
	MilestoneDone  int    `gorm:"-" json:"milestoneDone"`
	NextMilestone  string `gorm:"-" json:"nextMilestone"`
	NextDueIn      *int   `gorm:"-" json:"nextDueIn"`
}

// 收款节点。
// 流程是先干活、客户确认收货、之后才结款，所以确认收货日是一等字段：
// 没约定具体日期的款，从确认收货那天起算账期，超了就算逾期。
type Payment struct {
	Base
	ProjectID   uint       `gorm:"index;not null" json:"projectId"`
	Title       string     `gorm:"size:128" json:"title"` // 验收结款/首款/中介结款…
	Amount      float64    `json:"amount"`
	Status      string     `gorm:"size:16;index" json:"status"` // pending 待收 / received 已收 / overdue 已逾期
	ConfirmDate *time.Time `json:"confirmDate"`                 // 确认收货日
	PlanDate    *time.Time `json:"planDate"`                    // 约定收款日
	PaidDate    *time.Time `json:"paidDate"`                    // 实际到账日
	Note        string     `gorm:"size:512" json:"note"`

	// 只读派生字段：由后端算出来，前端不用自己判断
	Overdue  bool       `gorm:"-" json:"overdue"`
	DaysLate int        `gorm:"-" json:"daysLate"`
	DueDate  *time.Time `gorm:"-" json:"dueDate"` // 生效到期日：约定日，没填则按确认收货+账期推
	ProjectName string  `gorm:"-" json:"projectName"`
}

// 任务
type Task struct {
	Base
	Title    string `gorm:"size:255;not null;index" json:"title"`
	Desc     string `gorm:"type:text" json:"desc"`
	// 验收标准：任务完成的判定依据，一行一条。AI 完成后只流转到 review，
	// 人工对着这里逐条实测通过才算 done。
	AcceptCriteria string `gorm:"type:text" json:"acceptCriteria"`
	ProjectID *uint `gorm:"index" json:"projectId"`
	ClientID  *uint `gorm:"index" json:"clientId"`

	Status   string `gorm:"size:16;index" json:"status"`   // todo 待办 / doing 进行中 / review 待验收 / done 已完成 / canceled 已取消
	Priority string `gorm:"size:16;index" json:"priority"` // low 低 / normal 普通 / high 高 / urgent 紧急
	Kind     string `gorm:"size:16;index" json:"kind"`     // company 公司 / personal 个人 / freelance 私活

	DueDate        *time.Time `json:"dueDate"`
	RemindDays     int        `json:"remindDays"` // 提前提醒天数
	EstimateMinutes int       `json:"estimateMinutes"`
	ActualMinutes   int       `json:"actualMinutes"`
	Budget          float64   `json:"budget"`
	DoneAt          *time.Time `json:"doneAt"`
	Note            string    `gorm:"type:text" json:"note"`

	// 只读：子任务进度（不进数据库，查详情/列表时回填）
	Subtasks      []Subtask `gorm:"-" json:"subtasks,omitempty"`
	SubtaskDone   int       `gorm:"-" json:"subtaskDone"`
	SubtaskTotal  int       `gorm:"-" json:"subtaskTotal"`
}

// 子任务：一个任务内部的步骤清单。
// 像「上传代码 / 域名访问 / 完善信息 / 测试支付」这种一条任务下的多步动作，
// 拆成独立任务会丢掉「它们是一件事」的语义，所以放在任务内部当勾选步骤。
type Subtask struct {
	Base
	TaskID uint   `gorm:"index;not null" json:"taskId"`
	Title  string `gorm:"size:255;not null" json:"title"`
	Done   bool   `gorm:"index" json:"done"`
	Sort   int    `json:"sort"`
}

// 通用到期提醒（证书 / 域名 / 服务器续费 / 客户续费 / 其他）
type Reminder struct {
	Base
	Title    string `gorm:"size:255;not null" json:"title"`
	Category string `gorm:"size:24;index" json:"category"` // certificate 证书 / domain 域名 / server 服务器 / client 客户续费 / other 其他
	ProjectID *uint `gorm:"index" json:"projectId"`        // 关联项目（客户服务器上的服务）
	Target   string `gorm:"size:512" json:"target"`        // 域名 / 主机 / 说明

	ExpireAt   time.Time `json:"expireAt"`
	RemindDays int       `json:"remindDays"`

	// 证书专用
	Issuer string `gorm:"size:128" json:"issuer"`
	AutoRenew bool `json:"autoRenew"`

	Enabled bool   `gorm:"default:true" json:"enabled"`
	Note    string `gorm:"type:text" json:"note"`

	// 邮件提醒发送日期（YYYY-MM-DD），同一天内不重复发送；不对外输出
	NotifiedOn string `gorm:"size:10" json:"-"`
}

// 里程碑：项目内部进度节点（备案审核、交付验收等）
type Milestone struct {
	Base
	ProjectID uint   `gorm:"index;not null" json:"projectId"`
	Title     string `gorm:"size:255;not null" json:"title"`
	// 预期效果：做到什么程度算完成
	Expect string `gorm:"type:text" json:"expect"`
	// 状态：waiting 等待中 / done 已完成 / delayed 已延期 / canceled 已取消
	Status string `gorm:"size:16;index" json:"status"`
	Sort   int    `json:"sort"`

	StartDate *time.Time `json:"startDate"` // 开始/提交日
	// 工期计算方式：workday 工作日 / natural 自然日
	DayType string `gorm:"size:16" json:"dayType"`
	// 工期天数（与 dayType 配合推算 DueDate）
	Days int `gorm:"default:0" json:"days"`
	// 计算后的目标日期（可直接指定）
	DueDate *time.Time `json:"dueDate"`

	RemindDays int        `json:"remindDays"`
	DoneAt     *time.Time `json:"doneAt"`
	Note       string     `gorm:"type:text" json:"note"`

	// 只读
	ProjectName string `gorm:"-" json:"projectName"`
	DaysLeft    *int   `gorm:"-" json:"daysLeft"` // 距目标日期剩余天数（负数=已过期）
}

// 灵感记录：随时存下好文章、开源项目、公众号推送，之后慢慢消化。
// 是一个「收件箱」——先收集，再逐条吸收。
type Idea struct {
	Base
	Title   string `gorm:"size:255" json:"title"`   // 可留空，自动从链接/正文截取
	URL     string `gorm:"size:1024" json:"url"`    // 原文链接
	Source  string `gorm:"size:32;index" json:"source"` // wechat 公众号 / github 开源 / article 文章 / video 视频 / other 其他
	Content string `gorm:"type:text" json:"content"`    // 摘录 / 摘抄的正文片段
	Note    string `gorm:"type:text" json:"note"`       // 我自己的思考、怎么用

	// 消化状态：inbox 待看 / reading 在看 / digested 已消化 / archived 已归档
	Status string `gorm:"size:16;index" json:"status"`
	// 重要程度：1 一般 / 2 有用 / 3 很有价值
	Star int `json:"star"`

	// 自己的标签，逗号分隔（如：AI,前端,副业）
	Tags string `gorm:"size:255" json:"tags"`

	ProjectID *uint `gorm:"index" json:"projectId"` // 可选：这条灵感可用于哪个项目

	// 只读
	ProjectName string   `gorm:"-" json:"projectName"`
	TagList     []string `gorm:"-" json:"tagList"`
	ReadingMins int      `gorm:"-" json:"readingMins"` // 按正文字数估算阅读时间
}

// 内容库：Markdown 笔记、文章、客户素材，可生成公开只读分享链接。
type Content struct {
	Base
	Title  string `gorm:"size:255;not null;index" json:"title"`
	Kind   string `gorm:"size:16;index" json:"kind"`
	Status string `gorm:"size:16;index" json:"status"`
	Body   string `gorm:"type:text" json:"body,omitempty"`

	Tags         string `gorm:"size:255" json:"tags"`
	SourceIdeaID *uint  `gorm:"index" json:"sourceIdeaId"`
	ProjectID    *uint  `gorm:"index" json:"projectId"`
	ClientID     *uint  `gorm:"index" json:"clientId"`

	ShareToken     *string    `gorm:"size:64;uniqueIndex" json:"shareToken,omitempty"`
	ShareExpiresAt *time.Time `json:"shareExpiresAt"`

	// 只读
	TagList         []string `gorm:"-" json:"tagList"`
	ProjectName     string   `gorm:"-" json:"projectName"`
	ClientName      string   `gorm:"-" json:"clientName"`
	SourceIdeaTitle string   `gorm:"-" json:"sourceIdeaTitle"`
	ShareEnabled    bool     `gorm:"-" json:"shareEnabled"`
	ShareExpired    bool     `gorm:"-" json:"shareExpired"`
	SharePath       string   `gorm:"-" json:"sharePath"`
	Excerpt         string   `gorm:"-" json:"excerpt"`
	AttachmentCount int      `gorm:"-" json:"attachmentCount"`
	CoverURL        string   `gorm:"-" json:"coverUrl"`
}

// 标签
type Tag struct {
	Base
	Name  string `gorm:"size:64;uniqueIndex" json:"name"`
	Color string `gorm:"size:16" json:"color"`
}

// 多态标签关联
type Taggable struct {
	ID       uint   `gorm:"primarykey" json:"-"`
	TagID    uint   `gorm:"index" json:"tagId"`
	TargetID uint   `gorm:"index" json:"targetId"`
	Target   string `gorm:"size:16;index" json:"target"` // project / task
}

// 设置（键值）
type Setting struct {
	Key   string `gorm:"primarykey;size:64" json:"key"`
	Value string `gorm:"type:text" json:"value"`
}

// 附件：图片存在磁盘上，这里只存元数据。
//
// 存储策略（为什么不用对象存储 / base64）：
// - 存磁盘、挂在 data/ 卷下：备份数据库就是备份图片，不额外花钱，也不用配密钥
// - 文件按内容哈希命名：同一张图重复上传只占一份空间，多张图也不会重名
// - 数据库只存 hash/类型/大小：SQLite 不会被二进制撑大，备份和查询都还快
// - 不用 base64 塞进数据库或 JSON：体积会涨 33%，每次列表查询都要拖着它
//
// 一张物理文件可以被多条记录引用（比如同一张参考图挂到两个任务上）。
// 所以 Hash 不能是唯一索引——那样第二条记录就没法插，只能去改第一条，
// 结果就是「B 任务上传同一张图，A 任务的图神秘消失」。
// 删记录时要先看还有没有别的记录引用同一个 hash，没有了才删磁盘文件。
type Attachment struct {
	Base
	// 非唯一：多条记录可指向同一个物理文件
	Hash string `gorm:"size:64;index;not null" json:"hash"`
	// local 本地磁盘 / r2 Cloudflare R2；空值按 local 处理，兼容旧记录
	Storage string `gorm:"size:16;not null;default:local" json:"-"`
	// 原始文件名，仅用于下载时显示
	Name      string `gorm:"size:255" json:"name"`
	Mime      string `gorm:"size:128" json:"mime"`
	Size      int64  `json:"size"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	TaskID    *uint  `gorm:"index" json:"taskId"`
	ProjectID *uint  `gorm:"index" json:"projectId"`
	ContentID *uint  `gorm:"index" json:"contentId"`
	// 只读：访问地址
	URL string `gorm:"-" json:"url"`
}

func AllModels() []any {
	return []any{
		&User{}, &LoginAttempt{}, &Client{}, &Project{}, &Payment{}, &Task{},
		&Reminder{}, &Milestone{}, &Tag{}, &Taggable{}, &Setting{}, &Idea{},
		&Content{}, &Subtask{}, &Attachment{},
	}
}

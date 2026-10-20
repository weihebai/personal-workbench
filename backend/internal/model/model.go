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

// 收款节点
type Payment struct {
	Base
	ProjectID  uint       `gorm:"index;not null" json:"projectId"`
	Title      string     `gorm:"size:128" json:"title"` // 首款/中期款/尾款
	Amount     float64    `json:"amount"`
	Status     string     `gorm:"size:16;index" json:"status"` // pending 待收 / received 已收 / overdue 已逾期
	PlanDate   *time.Time `json:"planDate"`   // 约定收款日
	PaidDate   *time.Time `json:"paidDate"`   // 实际到账日
	Note       string     `gorm:"size:512" json:"note"`
}

// 任务
type Task struct {
	Base
	Title    string `gorm:"size:255;not null;index" json:"title"`
	Desc     string `gorm:"type:text" json:"desc"`
	ProjectID *uint `gorm:"index" json:"projectId"`
	ClientID  *uint `gorm:"index" json:"clientId"`

	Status   string `gorm:"size:16;index" json:"status"`   // todo 待办 / doing 进行中 / done 已完成 / canceled 已取消
	Priority string `gorm:"size:16;index" json:"priority"` // low 低 / normal 普通 / high 高 / urgent 紧急
	Kind     string `gorm:"size:16;index" json:"kind"`     // personal 个人 / freelance 私活

	DueDate        *time.Time `json:"dueDate"`
	RemindDays     int        `json:"remindDays"` // 提前提醒天数
	EstimateMinutes int       `json:"estimateMinutes"`
	ActualMinutes   int       `json:"actualMinutes"`
	Budget          float64   `json:"budget"`
	DoneAt          *time.Time `json:"doneAt"`
	Note            string    `gorm:"type:text" json:"note"`
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

func AllModels() []any {
	return []any{
		&User{}, &Client{}, &Project{}, &Payment{}, &Task{},
		&Reminder{}, &Milestone{}, &Tag{}, &Taggable{}, &Setting{}, &Idea{},
	}
}

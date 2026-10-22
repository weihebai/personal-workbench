package handler

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

type ideaInput struct {
	Title     string `json:"title"`
	URL       string `json:"url"`
	Source    string `json:"source"`
	Content   string `json:"content"`
	Note      string `json:"note"`
	Status    string `json:"status"`
	Star      int    `json:"star"`
	Tags      string `json:"tags"`
	ProjectID *uint  `json:"projectId"`
}

const (
	ideaTitleMax = 120
	ideaExcerpt  = 140
)

// deriveTitle 标题留空时，依次尝试：URL 的域名+路径 → 正文开头。
// 目的是让「只粘一个链接就保存」也能有可读的条目标题。
func deriveTitle(in ideaInput) string {
	if t := strings.TrimSpace(in.Title); t != "" {
		return t
	}
	if u := strings.TrimSpace(in.URL); u != "" {
		s := strings.TrimPrefix(u, "https://")
		s = strings.TrimPrefix(s, "http://")
		s = strings.TrimPrefix(s, "www.")
		if len(s) > 80 {
			s = s[:80]
		}
		return s
	}
	if c := strings.TrimSpace(in.Content); c != "" {
		r := []rune(c)
		if len(r) > ideaTitleMax {
			r = r[:ideaTitleMax]
		}
		return string(r)
	}
	// 纯笔记：用备注开头兜底，避免出现空标题条目
	r := []rune(strings.TrimSpace(in.Note))
	if len(r) > ideaTitleMax {
		r = r[:ideaTitleMax]
	}
	return string(r)
}

// normalizeIdea 统一清洗与默认值，避免各入口行为不一致。
func normalizeIdea(in *ideaInput) {
	in.Title = strings.TrimSpace(in.Title)
	in.URL = strings.TrimSpace(in.URL)
	in.Content = strings.TrimSpace(in.Content)
	in.Note = strings.TrimSpace(in.Note)
	in.Tags = strings.TrimSpace(in.Tags)
	if in.Source == "" {
		in.Source = guessSource(in.URL)
	}
	if in.Status == "" {
		in.Status = "inbox"
	}
	if in.Star < 0 {
		in.Star = 0
	}
	if in.Star > 3 {
		in.Star = 3
	}
}

// guessSource 从链接推断来源，省得每次手选
func guessSource(url string) string {
	u := strings.ToLower(url)
	switch {
	case strings.Contains(u, "mp.weixin.qq.com"):
		return "wechat"
	case strings.Contains(u, "github.com"), strings.Contains(u, "gitee.com"):
		return "github"
	case strings.Contains(u, "bilibili.com"), strings.Contains(u, "youtube.com"), strings.Contains(u, "douyin.com"):
		return "video"
	case u == "":
		return "note"
	default:
		return "article"
	}
}

// decorateIdeas 填充只读字段：关联项目名、标签数组、阅读时长估算
func (h *Handler) decorateIdeas(items []model.Idea) {
	if len(items) == 0 {
		return
	}
	ids := make([]uint, 0, len(items))
	for _, it := range items {
		if it.ProjectID != nil {
			ids = append(ids, *it.ProjectID)
		}
	}
	nameMap := map[uint]string{}
	if len(ids) > 0 {
		var ps []model.Project
		h.DB.Select("id, name").Where("id IN ?", ids).Find(&ps)
		for _, p := range ps {
			nameMap[p.ID] = p.Name
		}
	}
	for i := range items {
		it := &items[i]
		if it.ProjectID != nil {
			it.ProjectName = nameMap[*it.ProjectID]
		}
		it.TagList = splitTags(it.Tags)
		// 中文约 350 字/分钟
		n := utf8.RuneCountInString(it.Content)
		mins := n / 350
		if n > 0 && mins == 0 {
			mins = 1
		}
		it.ReadingMins = mins
	}
}

func splitTags(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// ListIdeas 灵感列表：支持按状态/来源/关键词/星级筛选
func (h *Handler) ListIdeas(c *gin.Context) {
	page, size := paginate(c)
	q := h.DB.Model(&model.Idea{})

	if s := strings.TrimSpace(c.Query("q")); s != "" {
		like := "%" + s + "%"
		q = q.Where("title LIKE ? OR content LIKE ? OR note LIKE ? OR tags LIKE ? OR url LIKE ?",
			like, like, like, like, like)
	}
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	if s := c.Query("source"); s != "" {
		q = q.Where("source = ?", s)
	}
	if s := c.Query("star"); s != "" {
		q = q.Where("star = ?", s)
	}
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		serverErr(c, err)
		return
	}
	items := []model.Idea{}
	// 收藏箱按「新存下的在前」排，符合收件箱习惯
	if err := q.Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	h.decorateIdeas(items)
	c.JSON(http.StatusOK, paginated(items, total, page, size))
}

// IdeaStats 各状态数量，用于页面顶部的筛选徽标
func (h *Handler) IdeaStats(c *gin.Context) {
	type row struct {
		Status string
		Count  int64
	}
	var rows []row
	h.DB.Model(&model.Idea{}).Select("status, COUNT(*) as count").Group("status").Scan(&rows)
	out := map[string]int64{"inbox": 0, "reading": 0, "digested": 0, "archived": 0}
	var total int64
	for _, r := range rows {
		out[r.Status] = r.Count
		total += r.Count
	}
	var starred int64
	h.DB.Model(&model.Idea{}).Where("star >= ?", 3).Count(&starred)
	c.JSON(http.StatusOK, gin.H{"byStatus": out, "total": total, "starred": starred})
}

func (h *Handler) CreateIdea(c *gin.Context) {
	var in ideaInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	normalizeIdea(&in)
	if in.Title == "" && in.URL == "" && in.Content == "" && in.Note == "" {
		badRequest(c, "至少填链接、标题或内容中的一项")
		return
	}
	if in.Title == "" {
		in.Title = resolveIdeaTitle(c.Request.Context(), in)
	}
	it := model.Idea{
		Title: in.Title, URL: in.URL, Source: in.Source,
		Content: in.Content, Note: in.Note, Status: in.Status,
		Star: in.Star, Tags: in.Tags, ProjectID: in.ProjectID,
	}
	if err := h.DB.Create(&it).Error; err != nil {
		serverErr(c, err)
		return
	}
	list := []model.Idea{it}
	h.decorateIdeas(list)
	c.JSON(http.StatusCreated, list[0])
}

func (h *Handler) UpdateIdea(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Idea
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "记录不存在")
		return
	}
	var in ideaInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	normalizeIdea(&in)
	if in.Title == "" {
		in.Title = resolveIdeaTitle(c.Request.Context(), in)
	}
	if in.Title == "" {
		badRequest(c, "标题不能为空")
		return
	}
	updates := map[string]any{
		"title": in.Title, "url": in.URL, "source": in.Source,
		"content": in.Content, "note": in.Note, "status": in.Status,
		"star": in.Star, "tags": in.Tags, "project_id": in.ProjectID,
	}
	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	var fresh model.Idea
	h.DB.First(&fresh, id)
	list := []model.Idea{fresh}
	h.decorateIdeas(list)
	c.JSON(http.StatusOK, list[0])
}

// QuickIdeaStatus 一键切换消化状态（收件箱 → 在看 → 已消化）
func (h *Handler) QuickIdeaStatus(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Idea
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "记录不存在")
		return
	}
	var in struct {
		Status string `json:"status"`
		Star   *int   `json:"star"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	updates := map[string]any{}
	if in.Status != "" {
		switch in.Status {
		case "inbox", "reading", "digested", "archived":
			updates["status"] = in.Status
		default:
			badRequest(c, "无效的状态")
			return
		}
	}
	if in.Star != nil {
		s := *in.Star
		if s < 0 {
			s = 0
		}
		if s > 3 {
			s = 3
		}
		updates["star"] = s
	}
	if len(updates) == 0 {
		badRequest(c, "没有需要更新的字段")
		return
	}
	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	var fresh model.Idea
	h.DB.First(&fresh, id)
	list := []model.Idea{fresh}
	h.decorateIdeas(list)
	c.JSON(http.StatusOK, list[0])
}

func (h *Handler) DeleteIdea(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	if err := h.DB.Delete(&model.Idea{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

package handler

import (
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	contentTitleMax    = 200
	contentBodyMax     = 512 << 10 // 512 KiB
	contentRequestMax  = 1 << 20   // 请求体上限 1 MiB
	contentTagMax      = 10
	contentTagRuneMax  = 24
	contentTagsRuneMax = 200
	contentExcerptMax  = 160
	contentListBodyCut = 400
)

var contentKinds = map[string]bool{
	"pitfall": true, "article": true, "client": true, "note": true,
}

var contentStatuses = map[string]bool{
	"draft": true, "ready": true, "published": true, "archived": true,
}

type contentInput struct {
	Title     string `json:"title"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	Body      string `json:"body"`
	Tags      string `json:"tags"`
	ProjectID *uint  `json:"projectId"`
	ClientID  *uint  `json:"clientId"`
}

// limitJSONBody 为创建/更新请求加体积上限，避免超大正文把内存吃光。
func limitJSONBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, contentRequestMax)
}

// normalizeContent 统一清洗与校验，返回空串表示通过。
func normalizeContent(in *contentInput) string {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		return "标题不能为空"
	}
	if utf8.RuneCountInString(in.Title) > contentTitleMax {
		return "标题不能超过 200 个字符"
	}

	// 前端 textarea / 不同系统的换行统一成 LF，避免库里混着 \r\n
	in.Body = strings.ReplaceAll(in.Body, "\r\n", "\n")
	in.Body = strings.ReplaceAll(in.Body, "\r", "\n")
	if len(in.Body) > contentBodyMax {
		return "正文不能超过 512 KB"
	}

	if in.Kind == "" {
		in.Kind = "note"
	} else if !contentKinds[in.Kind] {
		return "无效的内容类型"
	}
	if in.Status == "" {
		in.Status = "draft"
	} else if !contentStatuses[in.Status] {
		return "无效的状态"
	}

	tags, msg := normalizeContentTags(in.Tags)
	if msg != "" {
		return msg
	}
	in.Tags = tags

	if in.ProjectID != nil && *in.ProjectID == 0 {
		in.ProjectID = nil
	}
	if in.ClientID != nil && *in.ClientID == 0 {
		in.ClientID = nil
	}
	return ""
}

// parseContentTags 按逗号拆分、trim、去重（保留首次出现的顺序）。
func parseContentTags(s string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, p := range strings.Split(s, ",") {
		t := strings.TrimSpace(p)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

// normalizeContentTags 严格校验数量与长度；超限直接报错，不偷偷丢标签。
func normalizeContentTags(s string) (string, string) {
	tags := parseContentTags(s)
	if len(tags) > contentTagMax {
		return "", "最多只能有 10 个标签"
	}
	for _, t := range tags {
		if utf8.RuneCountInString(t) > contentTagRuneMax {
			return "", "单个标签不能超过 24 个字符"
		}
	}
	out := strings.Join(tags, ",")
	if utf8.RuneCountInString(out) > contentTagsRuneMax {
		return "", "标签总长度不能超过 200 个字符"
	}
	return out, ""
}

// contentTagsFromIdea 从灵感复制标签时放宽处理：只保留能装下的部分，
// 不让一条旧灵感因为标签超限而无法整理成内容。
func contentTagsFromIdea(s string) string {
	tags := parseContentTags(s)
	out := make([]string, 0, len(tags))
	total := 0
	for _, t := range tags {
		if len(out) >= contentTagMax {
			break
		}
		if r := []rune(t); len(r) > contentTagRuneMax {
			t = string(r[:contentTagRuneMax])
		}
		extra := 0
		if len(out) > 0 {
			extra = 1
		}
		if total+utf8.RuneCountInString(t)+extra > contentTagsRuneMax {
			break
		}
		out = append(out, t)
		total += utf8.RuneCountInString(t) + extra
	}
	return strings.Join(out, ",")
}

var (
	mdImage      = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	mdLink       = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	mdHeading    = regexp.MustCompile(`^#{1,6}\s*`)
	mdQuote      = regexp.MustCompile(`^>\s*`)
	mdListMarker = regexp.MustCompile(`^(?:[-+*]|\d+[.)])\s+`)
	mdTableSep   = regexp.MustCompile(`^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$`)
)

// makeContentExcerpt 从 Markdown 正文生成纯文本摘要。
// 去掉图片/链接语法、标题与列表标记、代码围栏，再按字符截断，
// 避免列表页把整篇长文和一堆符号塞进卡片。
func makeContentExcerpt(body string, max int) string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	var b strings.Builder
	inFence := false
	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		t = mdImage.ReplaceAllString(t, "")
		t = mdLink.ReplaceAllString(t, "$1")
		t = mdHeading.ReplaceAllString(t, "")
		t = mdQuote.ReplaceAllString(t, "")
		t = mdListMarker.ReplaceAllString(t, "")
		if mdTableSep.MatchString(t) {
			continue
		}
		t = strings.ReplaceAll(t, "|", " ")
		t = strings.ReplaceAll(t, "**", "")
		t = strings.ReplaceAll(t, "__", "")
		t = strings.ReplaceAll(t, "`", "")
		if t != "" {
			b.WriteString(t)
			b.WriteString(" ")
		}
	}
	out := strings.Join(strings.Fields(b.String()), " ")
	r := []rune(out)
	if len(r) > max {
		return string(r[:max]) + "…"
	}
	return out
}

func shareState(c *model.Content) {
	now := time.Now()
	if c.ShareToken == nil || *c.ShareToken == "" {
		return
	}
	if c.ShareExpiresAt != nil && !c.ShareExpiresAt.After(now) {
		c.ShareExpired = true
		return
	}
	c.ShareEnabled = true
	c.SharePath = "/share/" + *c.ShareToken
}

// decorateContents 批量补齐项目名、客户名、来源灵感标题、标签、附件与分享状态。
// keepBody=false 用于列表：生成摘要后清空正文，JSON 里不再出现 body。
func (h *Handler) decorateContents(items []model.Content, keepBody bool) {
	if len(items) == 0 {
		return
	}

	projectIDs := make([]uint, 0, len(items))
	clientIDs := make([]uint, 0, len(items))
	ideaIDs := make([]uint, 0, len(items))
	contentIDs := make([]uint, 0, len(items))
	for _, it := range items {
		if it.ProjectID != nil {
			projectIDs = append(projectIDs, *it.ProjectID)
		}
		if it.ClientID != nil {
			clientIDs = append(clientIDs, *it.ClientID)
		}
		if it.SourceIdeaID != nil {
			ideaIDs = append(ideaIDs, *it.SourceIdeaID)
		}
		contentIDs = append(contentIDs, it.ID)
	}

	projectNames := map[uint]string{}
	if len(projectIDs) > 0 {
		var ps []model.Project
		h.DB.Select("id, name").Where("id IN ?", projectIDs).Find(&ps)
		for _, p := range ps {
			projectNames[p.ID] = p.Name
		}
	}
	clientNames := map[uint]string{}
	if len(clientIDs) > 0 {
		var cs []model.Client
		h.DB.Select("id, name").Where("id IN ?", clientIDs).Find(&cs)
		for _, c := range cs {
			clientNames[c.ID] = c.Name
		}
	}
	ideaTitles := map[uint]string{}
	if len(ideaIDs) > 0 {
		var is []model.Idea
		h.DB.Select("id, title").Where("id IN ?", ideaIDs).Find(&is)
		for _, i := range is {
			ideaTitles[i.ID] = i.Title
		}
	}

	// 附件按内容分组：数量 + 第一张作为封面
	type attInfo struct {
		count int
		cover string
	}
	attMap := map[uint]*attInfo{}
	var atts []model.Attachment
	h.DB.Select("id, content_id, hash").Where("content_id IN ?", contentIDs).Order("id ASC").Find(&atts)
	for _, a := range atts {
		if a.ContentID == nil {
			continue
		}
		info := attMap[*a.ContentID]
		if info == nil {
			info = &attInfo{}
			attMap[*a.ContentID] = info
		}
		info.count++
		if info.cover == "" {
			info.cover = "/api/attachments/" + a.Hash + "/raw"
		}
	}

	for i := range items {
		it := &items[i]
		it.TagList = splitTags(it.Tags)
		if it.TagList == nil {
			it.TagList = []string{}
		}
		if it.ProjectID != nil {
			it.ProjectName = projectNames[*it.ProjectID]
		}
		if it.ClientID != nil {
			it.ClientName = clientNames[*it.ClientID]
		}
		if it.SourceIdeaID != nil {
			it.SourceIdeaTitle = ideaTitles[*it.SourceIdeaID]
		}
		if info := attMap[it.ID]; info != nil {
			it.AttachmentCount = info.count
			it.CoverURL = info.cover
		}
		shareState(it)
		if !keepBody {
			it.Excerpt = makeContentExcerpt(it.Body, contentExcerptMax)
			it.Body = ""
		}
	}
}

func (h *Handler) contentRefsExist(c *gin.Context, in contentInput) bool {
	if in.ProjectID != nil {
		var n int64
		h.DB.Model(&model.Project{}).Where("id = ?", *in.ProjectID).Count(&n)
		if n == 0 {
			badRequest(c, "关联项目不存在")
			return false
		}
	}
	if in.ClientID != nil {
		var n int64
		h.DB.Model(&model.Client{}).Where("id = ?", *in.ClientID).Count(&n)
		if n == 0 {
			badRequest(c, "关联客户不存在")
			return false
		}
	}
	return true
}

func (h *Handler) findContent(c *gin.Context) (*model.Content, bool) {
	id, ok := paramUint(c, "id")
	if !ok {
		return nil, false
	}
	var cur model.Content
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "内容不存在")
		return nil, false
	}
	return &cur, true
}

// ListContents 内容列表：支持关键词/类型/状态/项目/客户筛选。
// 列表刻意不返回正文，只用 SQL 截 400 字符生成摘要。
func (h *Handler) ListContents(c *gin.Context) {
	page, size := paginate(c)
	q := h.DB.Model(&model.Content{})

	if s := strings.TrimSpace(c.Query("q")); s != "" {
		like := "%" + s + "%"
		q = q.Where("title LIKE ? OR body LIKE ? OR tags LIKE ?", like, like, like)
	}
	if s := c.Query("kind"); s != "" {
		q = q.Where("kind = ?", s)
	}
	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}
	if id := queryUint(c, "clientId"); id != nil {
		q = q.Where("client_id = ?", *id)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		serverErr(c, err)
		return
	}

	items := []model.Content{}
	err := q.Select(`id, title, kind, status, tags, source_idea_id, project_id, client_id,
			share_token, share_expires_at, created_at, updated_at,
			substr(body, 1, ?) AS body`, contentListBodyCut).
		Order("updated_at DESC, id DESC").
		Offset((page - 1) * size).Limit(size).Find(&items).Error
	if err != nil {
		serverErr(c, err)
		return
	}
	h.decorateContents(items, false)
	c.JSON(http.StatusOK, paginated(items, total, page, size))
}

// ContentStats 类型/状态分布，以及当前仍在有效期内的分享数。
func (h *Handler) ContentStats(c *gin.Context) {
	var kindRows []struct {
		Kind  string
		Count int64
	}
	h.DB.Model(&model.Content{}).Select("kind, COUNT(*) as count").Group("kind").Scan(&kindRows)
	byKind := map[string]int64{"pitfall": 0, "article": 0, "client": 0, "note": 0}
	var total int64
	for _, r := range kindRows {
		byKind[r.Kind] = r.Count
		total += r.Count
	}

	var statusRows []struct {
		Status string
		Count  int64
	}
	h.DB.Model(&model.Content{}).Select("status, COUNT(*) as count").Group("status").Scan(&statusRows)
	byStatus := map[string]int64{"draft": 0, "ready": 0, "published": 0, "archived": 0}
	for _, r := range statusRows {
		byStatus[r.Status] = r.Count
	}

	var shared int64
	h.DB.Model(&model.Content{}).
		Where("share_token IS NOT NULL AND (share_expires_at IS NULL OR share_expires_at > ?)", time.Now()).
		Count(&shared)

	c.JSON(http.StatusOK, gin.H{
		"total": total, "byKind": byKind, "byStatus": byStatus, "shared": shared,
	})
}

func (h *Handler) CreateContent(c *gin.Context) {
	limitJSONBody(c)
	var in contentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if msg := normalizeContent(&in); msg != "" {
		badRequest(c, msg)
		return
	}
	if !h.contentRefsExist(c, in) {
		return
	}

	item := model.Content{
		Title: in.Title, Kind: in.Kind, Status: in.Status, Body: in.Body,
		Tags: in.Tags, ProjectID: in.ProjectID, ClientID: in.ClientID,
	}
	if err := h.DB.Create(&item).Error; err != nil {
		serverErr(c, err)
		return
	}
	list := []model.Content{item}
	h.decorateContents(list, true)
	c.JSON(http.StatusCreated, list[0])
}

func (h *Handler) GetContent(c *gin.Context) {
	cur, ok := h.findContent(c)
	if !ok {
		return
	}
	list := []model.Content{*cur}
	h.decorateContents(list, true)
	c.JSON(http.StatusOK, list[0])
}

func (h *Handler) UpdateContent(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Content
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "内容不存在")
		return
	}

	limitJSONBody(c)
	var in contentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "参数错误")
		return
	}
	if msg := normalizeContent(&in); msg != "" {
		badRequest(c, msg)
		return
	}
	if !h.contentRefsExist(c, in) {
		return
	}

	updates := map[string]any{
		"title": in.Title, "kind": in.Kind, "status": in.Status,
		"body": in.Body, "tags": in.Tags,
		"project_id": in.ProjectID, "client_id": in.ClientID,
	}
	if err := h.DB.Model(&cur).Updates(updates).Error; err != nil {
		serverErr(c, err)
		return
	}
	var fresh model.Content
	h.DB.First(&fresh, id)
	list := []model.Content{fresh}
	h.decorateContents(list, true)
	c.JSON(http.StatusOK, list[0])
}

func (h *Handler) DeleteContent(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var cur model.Content
	if err := h.DB.First(&cur, id).Error; err != nil {
		notFound(c, "内容不存在")
		return
	}

	err := h.DB.Transaction(func(tx *gorm.DB) error {
		// 先让公开链接立刻失效，再做软删除
		if err := tx.Model(&model.Content{}).Where("id = ?", id).
			Updates(map[string]any{"share_token": nil, "share_expires_at": nil}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Content{}, id).Error
	})
	if err != nil {
		serverErr(c, err)
		return
	}
	// 文件系统操作放在事务外，避免长事务
	h.dropAttachmentsBy("content_id", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type fromIdeaInput struct {
	IdeaID uint   `json:"ideaId"`
	Kind   string `json:"kind"`
}

// CreateContentFromIdea 把一条灵感整理成内容草稿。
// 同一个灵感只会生成一条内容，重复点击直接返回已有记录。
func (h *Handler) CreateContentFromIdea(c *gin.Context) {
	limitJSONBody(c)
	var in fromIdeaInput
	if err := c.ShouldBindJSON(&in); err != nil || in.IdeaID == 0 {
		badRequest(c, "参数错误")
		return
	}
	if in.Kind == "" {
		in.Kind = "article"
	} else if !contentKinds[in.Kind] {
		badRequest(c, "无效的内容类型")
		return
	}

	var idea model.Idea
	if err := h.DB.First(&idea, in.IdeaID).Error; err != nil {
		notFound(c, "灵感不存在")
		return
	}

	var existing model.Content
	if err := h.DB.Where("source_idea_id = ?", in.IdeaID).First(&existing).Error; err == nil {
		list := []model.Content{existing}
		h.decorateContents(list, true)
		c.JSON(http.StatusOK, list[0])
		return
	}

	title := strings.TrimSpace(idea.Title)
	if title == "" {
		title = "未命名内容"
	}
	title = truncate(title, contentTitleMax)

	parts := []string{}
	if note := strings.TrimSpace(idea.Note); note != "" {
		parts = append(parts, note)
	}
	if content := strings.TrimSpace(idea.Content); content != "" {
		var b strings.Builder
		for _, line := range strings.Split(normalizeContentBody(content), "\n") {
			t := strings.TrimRight(line, " \t")
			if t == "" {
				b.WriteString(">\n")
				continue
			}
			b.WriteString("> ")
			b.WriteString(t)
			b.WriteString("\n")
		}
		parts = append(parts, strings.TrimRight(b.String(), "\n"))
	}
	if u := strings.TrimSpace(idea.URL); u != "" {
		linkTitle := strings.TrimSpace(idea.Title)
		if linkTitle == "" {
			linkTitle = u
		}
		parts = append(parts, "来源：["+linkTitle+"]("+u+")")
	}
	body := truncateBytes(strings.Join(parts, "\n\n"), contentBodyMax)

	item := model.Content{
		Title: title, Kind: in.Kind, Status: "draft", Body: body,
		Tags:         contentTagsFromIdea(idea.Tags),
		ProjectID:    idea.ProjectID,
		SourceIdeaID: &idea.ID,
	}
	if err := h.DB.Create(&item).Error; err != nil {
		serverErr(c, err)
		return
	}
	list := []model.Content{item}
	h.decorateContents(list, true)
	c.JSON(http.StatusCreated, list[0])
}

func normalizeContentBody(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

// truncateBytes 按字节上限截断，并退到合法 UTF-8 边界，避免切出乱码。
func truncateBytes(s string, max int) string {
	if len(s) <= max {
		return s
	}
	b := []byte(s)[:max]
	for len(b) > 0 && !utf8.Valid(b) {
		b = b[:len(b)-1]
	}
	return string(b)
}

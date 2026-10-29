package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

func newContentRouter(h *Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/contents", h.ListContents)
	r.GET("/contents/stats", h.ContentStats)
	r.POST("/contents", h.CreateContent)
	r.POST("/contents/from-idea", h.CreateContentFromIdea)
	r.GET("/contents/:id", h.GetContent)
	r.PUT("/contents/:id", h.UpdateContent)
	r.DELETE("/contents/:id", h.DeleteContent)
	return r
}

func contentReq(t *testing.T, r *gin.Engine, method, path string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("序列化请求失败: %v", err)
		}
		body = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeBody[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析响应失败: %v\n%s", err, w.Body.String())
	}
	return out
}

func TestNormalizeContent(t *testing.T) {
	// 标题必填（trim 后为空也不行）
	if msg := normalizeContent(&contentInput{Body: "内容"}); msg != "标题不能为空" {
		t.Fatalf("空标题应报错，得到 %q", msg)
	}

	// 默认类型/状态 + 标题 trim + 换行归一
	in := contentInput{Title: "  我的笔记  ", Body: "第一行\r\n第二行\r第三行"}
	if msg := normalizeContent(&in); msg != "" {
		t.Fatalf("合法输入不该报错: %s", msg)
	}
	if in.Title != "我的笔记" {
		t.Errorf("标题应 trim，得到 %q", in.Title)
	}
	if in.Kind != "note" || in.Status != "draft" {
		t.Errorf("默认值应为 note/draft，得到 %s/%s", in.Kind, in.Status)
	}
	if in.Body != "第一行\n第二行\n第三行" {
		t.Errorf("CRLF/CR 应归一为 LF，得到 %q", in.Body)
	}

	// 非法类型与状态
	if msg := normalizeContent(&contentInput{Title: "t", Kind: "post"}); msg != "无效的内容类型" {
		t.Errorf("非法类型应报错，得到 %q", msg)
	}
	if msg := normalizeContent(&contentInput{Title: "t", Status: "live"}); msg != "无效的状态" {
		t.Errorf("非法状态应报错，得到 %q", msg)
	}

	// 标签去重、去空、trim
	in = contentInput{Title: "t", Tags: " AI, 前端 ,, AI "}
	if msg := normalizeContent(&in); msg != "" {
		t.Fatalf("标签清洗失败: %s", msg)
	}
	if in.Tags != "AI,前端" {
		t.Errorf("标签应去重并 trim，得到 %q", in.Tags)
	}

	// 标签数量上限
	many := make([]string, 0, 11)
	for i := 0; i < 11; i++ {
		many = append(many, string(rune('a'+i)))
	}
	if msg := normalizeContent(&contentInput{Title: "t", Tags: strings.Join(many, ",")}); msg == "" {
		t.Error("超过 10 个标签应报错")
	}

	// 单个标签长度上限
	longTag := strings.Repeat("灵", contentTagRuneMax+1)
	if msg := normalizeContent(&contentInput{Title: "t", Tags: longTag}); msg == "" {
		t.Error("超长标签应报错")
	}

	// 标题按字符计数：200 个中文字符合法，201 个报错
	okTitle := strings.Repeat("灵", contentTitleMax)
	if msg := normalizeContent(&contentInput{Title: okTitle}); msg != "" {
		t.Errorf("%d 字标题应合法，得到 %q", contentTitleMax, msg)
	}
	tooLong := strings.Repeat("灵", contentTitleMax+1)
	if msg := normalizeContent(&contentInput{Title: tooLong}); msg == "" {
		t.Error("超过 200 字的标题应报错")
	}
}

func TestMakeContentExcerpt(t *testing.T) {
	body := "# 标题\n\n" +
		"这是第一段，带 [链接](https://example.com) 和 ![截图](/api/attachments/abc/raw)。\n\n" +
		"- 列表项一\n" +
		"- 列表项二\n\n" +
		"> 引用内容\n\n" +
		"| 字段 | 原因 |\n| --- | --- |\n| 证件 | **背景不一致** |\n\n" +
		"```go\nfunc main() {}\n```\n\n" +
		"结尾段落"

	got := makeContentExcerpt(body, contentExcerptMax)
	for _, bad := range []string{"#", "![", "](https", "```", "func main", "- ", "|", "---", "**"} {
		if strings.Contains(got, bad) {
			t.Errorf("摘要不该包含 Markdown 标记 %q: %s", bad, got)
		}
	}
	for _, want := range []string{"标题", "这是第一段", "链接", "列表项一", "引用内容", "结尾段落"} {
		if !strings.Contains(got, want) {
			t.Errorf("摘要应包含正文内容 %q: %s", want, got)
		}
	}

	// 超长中文按字符截断，不能切出乱码
	long := strings.Repeat("灵", 500)
	out := makeContentExcerpt(long, contentExcerptMax)
	runes := []rune(out)
	if len(runes) != contentExcerptMax+1 { // 160 字 + 省略号
		t.Fatalf("应截断到 %d 字加省略号，实际 %d", contentExcerptMax, len(runes))
	}
	if runes[len(runes)-1] != '…' {
		t.Errorf("截断后应补省略号，得到 %q", runes[len(runes)-1])
	}
	for _, r := range runes[:contentExcerptMax] {
		if r != '灵' {
			t.Fatalf("截断产生了乱码字符 %q", r)
		}
	}
}

func TestCreateContentFromIdeaIdempotent(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentRouter(h)

	project := model.Project{Name: "微信小程序", Kind: "outsource", Status: "active"}
	if err := h.DB.Create(&project).Error; err != nil {
		t.Fatalf("建项目失败: %v", err)
	}

	idea := model.Idea{
		Title:     "备案驳回记录",
		URL:       "https://example.com/filing",
		Content:   "证件背景不一致\r\n边角不齐全",
		Note:      "下次提交前先统一背景",
		Status:    "inbox",
		Tags:      "微信小程序,备案",
		ProjectID: &project.ID,
	}
	if err := h.DB.Create(&idea).Error; err != nil {
		t.Fatalf("建灵感失败: %v", err)
	}

	first := contentReq(t, r, http.MethodPost, "/contents/from-idea", map[string]any{"ideaId": idea.ID})
	if first.Code != http.StatusCreated {
		t.Fatalf("首次整理应返回 201，得到 %d %s", first.Code, first.Body.String())
	}
	created := decodeBody[model.Content](t, first)
	if created.Title != idea.Title || created.Kind != "article" || created.Status != "draft" {
		t.Errorf("默认字段不对: %+v", created)
	}
	if created.SourceIdeaID == nil || *created.SourceIdeaID != idea.ID {
		t.Errorf("应记录来源灵感，得到 %v", created.SourceIdeaID)
	}
	for _, want := range []string{
		"下次提交前先统一背景", "> 证件背景不一致", "> 边角不齐全",
		"来源：[备案驳回记录](https://example.com/filing)",
	} {
		if !strings.Contains(created.Body, want) {
			t.Errorf("正文应包含 %q，实际:\n%s", want, created.Body)
		}
	}
	if created.Tags != "微信小程序,备案" {
		t.Errorf("标签应复制灵感，得到 %q", created.Tags)
	}
	if created.ProjectID == nil || *created.ProjectID != project.ID {
		t.Errorf("项目关联应复制，得到 %v", created.ProjectID)
	}
	if created.ProjectName != project.Name {
		t.Errorf("应回填项目名，得到 %q", created.ProjectName)
	}
	if created.SourceIdeaTitle != idea.Title {
		t.Errorf("应回填来源标题，得到 %q", created.SourceIdeaTitle)
	}

	// 再点一次：返回已有记录，不重复创建
	second := contentReq(t, r, http.MethodPost, "/contents/from-idea", map[string]any{"ideaId": idea.ID})
	if second.Code != http.StatusOK {
		t.Fatalf("重复整理应返回 200，得到 %d %s", second.Code, second.Body.String())
	}
	again := decodeBody[model.Content](t, second)
	if again.ID != created.ID {
		t.Errorf("应返回同一条内容，首次 %d 再次 %d", created.ID, again.ID)
	}
	var count int64
	h.DB.Model(&model.Content{}).Where("source_idea_id = ?", idea.ID).Count(&count)
	if count != 1 {
		t.Fatalf("同一灵感只应产生 1 条内容，实际 %d", count)
	}

	// 整理成内容不应改变灵感自身状态
	var fresh model.Idea
	h.DB.First(&fresh, idea.ID)
	if fresh.Status != "inbox" {
		t.Errorf("灵感状态不该被修改，得到 %q", fresh.Status)
	}
}

func TestContentListOmitsBody(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentRouter(h)

	long := "# 标题\n\n" + strings.Repeat("正文内容", 300)
	w := contentReq(t, r, http.MethodPost, "/contents", map[string]any{
		"title": "长文", "kind": "pitfall", "body": long, "tags": "备案,小程序",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("创建失败: %d %s", w.Code, w.Body.String())
	}

	lw := contentReq(t, r, http.MethodGet, "/contents", nil)
	if lw.Code != http.StatusOK {
		t.Fatalf("列表失败: %d %s", lw.Code, lw.Body.String())
	}
	out := decodeBody[map[string]any](t, lw)
	items, ok := out["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("应返回 1 条，得到 %v", out["items"])
	}
	item := items[0].(map[string]any)
	if _, exists := item["body"]; exists {
		t.Error("列表不应返回正文 body")
	}
	excerpt, _ := item["excerpt"].(string)
	if !strings.Contains(excerpt, "正文内容") {
		t.Errorf("摘要应由正文生成，得到 %q", excerpt)
	}
	if n := len([]rune(excerpt)); n > contentExcerptMax+1 {
		t.Errorf("摘要最多 %d 字，实际 %d", contentExcerptMax, n)
	}
	if item["kind"] != "pitfall" || item["status"] != "draft" {
		t.Errorf("类型/状态不对: %v / %v", item["kind"], item["status"])
	}
}

func TestDeleteContent(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentRouter(h)

	w := contentReq(t, r, http.MethodPost, "/contents", map[string]any{"title": "待删除"})
	created := decodeBody[model.Content](t, w)

	dw := contentReq(t, r, http.MethodDelete, "/contents/"+itoa(int(created.ID)), nil)
	if dw.Code != http.StatusOK {
		t.Fatalf("删除失败: %d %s", dw.Code, dw.Body.String())
	}
	if gw := contentReq(t, r, http.MethodGet, "/contents/"+itoa(int(created.ID)), nil); gw.Code != http.StatusNotFound {
		t.Errorf("删除后详情应 404，得到 %d", gw.Code)
	}
	lw := contentReq(t, r, http.MethodGet, "/contents", nil)
	out := decodeBody[map[string]any](t, lw)
	if items, _ := out["items"].([]any); len(items) != 0 {
		t.Errorf("删除后列表应为空，得到 %v", items)
	}
	// 软删除：记录还在，但默认查询看不到
	var n int64
	h.DB.Model(&model.Content{}).Count(&n)
	if n != 0 {
		t.Errorf("默认查询应看不到软删除记录，得到 %d", n)
	}
}

func newShareRouter(h *Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/contents", h.CreateContent)
	r.GET("/contents/:id", h.GetContent)
	r.POST("/contents/:id/share", h.ShareContent)
	r.POST("/contents/:id/share/rotate", h.RotateContentShare)
	r.DELETE("/contents/:id/share", h.RevokeContentShare)
	r.GET("/public/contents/:token", h.GetPublicContent)
	return r
}

func createTestContent(t *testing.T, h *Handler) model.Content {
	t.Helper()
	item := model.Content{
		Title:  "微信小程序备案被驳回的 3 个原因",
		Kind:   "pitfall",
		Status: "draft",
		Body:   "## 驳回原因\n\n主体负责人证件背景不一致。",
		Tags:   "微信小程序,备案",
	}
	if err := h.DB.Create(&item).Error; err != nil {
		t.Fatalf("建内容失败: %v", err)
	}
	return item
}

func TestShareLifecycle(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newShareRouter(h)
	item := createTestContent(t, h)
	base := "/contents/" + itoa(int(item.ID))

	w := contentReq(t, r, http.MethodPost, base+"/share", map[string]any{"expiresInDays": 7})
	if w.Code != http.StatusOK {
		t.Fatalf("生成分享失败: %d %s", w.Code, w.Body.String())
	}
	shared := decodeBody[model.Content](t, w)
	if !shared.ShareEnabled || shared.ShareExpired {
		t.Fatalf("分享状态不对: enabled=%v expired=%v", shared.ShareEnabled, shared.ShareExpired)
	}
	if !strings.HasPrefix(shared.SharePath, "/share/") {
		t.Fatalf("分享路径不对: %q", shared.SharePath)
	}
	token := strings.TrimPrefix(shared.SharePath, "/share/")
	if len(token) != 64 {
		t.Fatalf("Token 应为 64 位，得到 %d", len(token))
	}
	if shared.ShareExpiresAt == nil {
		t.Fatal("7 天有效期应有到期时间")
	}

	// 公开读取：无需任何鉴权
	pub := contentReq(t, r, http.MethodGet, "/public/contents/"+token, nil)
	if pub.Code != http.StatusOK {
		t.Fatalf("公开读取失败: %d %s", pub.Code, pub.Body.String())
	}
	got := decodeBody[publicContent](t, pub)
	if got.Title != item.Title || !strings.Contains(got.Body, "驳回原因") {
		t.Errorf("公开内容不对: %+v", got)
	}

	// 轮换：旧链接立刻失效，新链接可用
	rw := contentReq(t, r, http.MethodPost, base+"/share/rotate", nil)
	if rw.Code != http.StatusOK {
		t.Fatalf("轮换失败: %d %s", rw.Code, rw.Body.String())
	}
	rotated := decodeBody[model.Content](t, rw)
	newToken := strings.TrimPrefix(rotated.SharePath, "/share/")
	if newToken == token {
		t.Fatal("轮换后 Token 应变化")
	}
	if code := contentReq(t, r, http.MethodGet, "/public/contents/"+token, nil).Code; code != http.StatusNotFound {
		t.Errorf("旧链接应 404，得到 %d", code)
	}
	if code := contentReq(t, r, http.MethodGet, "/public/contents/"+newToken, nil).Code; code != http.StatusOK {
		t.Errorf("新链接应 200，得到 %d", code)
	}

	// 撤销：新链接也失效
	dw := contentReq(t, r, http.MethodDelete, base+"/share", nil)
	if dw.Code != http.StatusOK {
		t.Fatalf("撤销失败: %d %s", dw.Code, dw.Body.String())
	}
	revoked := decodeBody[model.Content](t, dw)
	if revoked.ShareEnabled || revoked.SharePath != "" {
		t.Errorf("撤销后不应再有分享链接: %+v", revoked)
	}
	if code := contentReq(t, r, http.MethodGet, "/public/contents/"+newToken, nil).Code; code != http.StatusNotFound {
		t.Errorf("撤销后应 404，得到 %d", code)
	}
	var fresh model.Content
	h.DB.First(&fresh, item.ID)
	if fresh.ShareToken != nil || fresh.ShareExpiresAt != nil {
		t.Error("撤销后 Token / 到期时间应置空")
	}
}

func TestShareExpiry(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newShareRouter(h)
	item := createTestContent(t, h)
	base := "/contents/" + itoa(int(item.ID))

	w := contentReq(t, r, http.MethodPost, base+"/share", map[string]any{"expiresInDays": 0})
	if w.Code != http.StatusOK {
		t.Fatalf("生成永久分享失败: %d %s", w.Code, w.Body.String())
	}
	shared := decodeBody[model.Content](t, w)
	if shared.ShareExpiresAt != nil {
		t.Fatal("永久分享不该有到期时间")
	}
	token := strings.TrimPrefix(shared.SharePath, "/share/")

	// 手工改成昨天过期
	past := time.Now().AddDate(0, 0, -1)
	h.DB.Model(&model.Content{}).Where("id = ?", item.ID).Update("share_expires_at", past)

	if code := contentReq(t, r, http.MethodGet, "/public/contents/"+token, nil).Code; code != http.StatusNotFound {
		t.Errorf("过期链接应 404，得到 %d", code)
	}
	gw := contentReq(t, r, http.MethodGet, base, nil)
	detail := decodeBody[model.Content](t, gw)
	if !detail.ShareExpired || detail.ShareEnabled {
		t.Errorf("详情应显示已过期: enabled=%v expired=%v", detail.ShareEnabled, detail.ShareExpired)
	}

	// 过期后再生成：换新 Token
	rw := contentReq(t, r, http.MethodPost, base+"/share", map[string]any{"expiresInDays": 7})
	if rw.Code != http.StatusOK {
		t.Fatalf("过期后重新生成失败: %d %s", rw.Code, rw.Body.String())
	}
	fresh := decodeBody[model.Content](t, rw)
	newToken := strings.TrimPrefix(fresh.SharePath, "/share/")
	if newToken == token {
		t.Error("过期后重新生成应换新 Token")
	}
	if code := contentReq(t, r, http.MethodGet, "/public/contents/"+token, nil).Code; code != http.StatusNotFound {
		t.Errorf("旧 Token 仍应 404，得到 %d", code)
	}
	if code := contentReq(t, r, http.MethodGet, "/public/contents/"+newToken, nil).Code; code != http.StatusOK {
		t.Errorf("新 Token 应 200，得到 %d", code)
	}
}

func TestShareUpdatesExpiryWithoutChangingToken(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newShareRouter(h)
	item := createTestContent(t, h)
	base := "/contents/" + itoa(int(item.ID))

	first := decodeBody[model.Content](t, contentReq(t, r, http.MethodPost, base+"/share", map[string]any{"expiresInDays": 7}))
	token := strings.TrimPrefix(first.SharePath, "/share/")
	firstExpiry := *first.ShareExpiresAt

	second := decodeBody[model.Content](t, contentReq(t, r, http.MethodPost, base+"/share", map[string]any{"expiresInDays": 30}))
	if got := strings.TrimPrefix(second.SharePath, "/share/"); got != token {
		t.Errorf("更新有效期不该换 Token，得到 %s want %s", got, token)
	}
	if !second.ShareExpiresAt.After(firstExpiry) {
		t.Errorf("30 天有效期应晚于 7 天: %v vs %v", second.ShareExpiresAt, firstExpiry)
	}

	// 改成永久：到期时间清空，Token 不变
	third := decodeBody[model.Content](t, contentReq(t, r, http.MethodPost, base+"/share", map[string]any{"expiresInDays": 0}))
	if got := strings.TrimPrefix(third.SharePath, "/share/"); got != token {
		t.Errorf("改为永久不该换 Token，得到 %s", got)
	}
	if third.ShareExpiresAt != nil {
		t.Error("永久分享的到期时间应为空")
	}
}

func TestPublicContentPayload(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newShareRouter(h)
	item := createTestContent(t, h)

	project := model.Project{Name: "不该暴露的项目"}
	client := model.Client{Name: "不该暴露的客户"}
	h.DB.Create(&project)
	h.DB.Create(&client)
	h.DB.Model(&item).Updates(map[string]any{"project_id": project.ID, "client_id": client.ID})

	if err := h.DB.Create(&model.Attachment{
		Hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
		Name: "内部文件名.png", Mime: "image/png",
		Width: 1200, Height: 800, ContentID: &item.ID,
	}).Error; err != nil {
		t.Fatalf("建附件失败: %v", err)
	}

	shared := decodeBody[model.Content](t, contentReq(t, r, http.MethodPost, "/contents/"+itoa(int(item.ID))+"/share", map[string]any{"expiresInDays": 7}))
	token := strings.TrimPrefix(shared.SharePath, "/share/")
	pub := contentReq(t, r, http.MethodGet, "/public/contents/"+token, nil)

	// 顶层只能是白名单里的 5 个键
	var raw map[string]any
	if err := json.Unmarshal(pub.Body.Bytes(), &raw); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(raw) != 5 {
		t.Errorf("公开响应应只有 5 个字段，得到 %d: %v", len(raw), raw)
	}
	for _, key := range []string{"title", "body", "tags", "updatedAt", "attachments"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("缺少字段 %q", key)
		}
	}

	body := pub.Body.String()
	for _, secret := range []string{"shareToken", "sharePath", "shareExpiresAt", "projectId", "clientId", "sourceIdeaId", "status", "kind", "内部文件名"} {
		if strings.Contains(body, secret) {
			t.Errorf("公开响应不该包含 %q: %s", secret, body)
		}
	}

	atts, _ := raw["attachments"].([]any)
	if len(atts) != 1 {
		t.Fatalf("应返回 1 张图片，得到 %v", raw["attachments"])
	}
	att := atts[0].(map[string]any)
	if att["url"] != "/api/attachments/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789/raw" {
		t.Errorf("图片地址不对: %v", att["url"])
	}
	if att["width"] != float64(1200) || att["height"] != float64(800) {
		t.Errorf("图片尺寸不对: %v x %v", att["width"], att["height"])
	}
	tags, _ := raw["tags"].([]any)
	if len(tags) != 2 || tags[0] != "微信小程序" || tags[1] != "备案" {
		t.Errorf("标签数组不对: %v", raw["tags"])
	}
}

func TestPublicShareHeaders(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newShareRouter(h)
	item := createTestContent(t, h)

	// 不存在的 Token 也必须带安全头
	w := contentReq(t, r, http.MethodGet, "/public/contents/"+strings.Repeat("a", 64), nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("应为 404，得到 %d", w.Code)
	}
	check := func(name, want string) {
		if got := w.Header().Get(name); got != want {
			t.Errorf("%s = %q，应为 %q", name, got, want)
		}
	}
	check("Cache-Control", "no-store")
	check("X-Robots-Tag", "noindex, nofollow, noarchive")
	check("Referrer-Policy", "no-referrer")
	check("X-Content-Type-Options", "nosniff")
	if !strings.Contains(w.Body.String(), publicShareGone) {
		t.Errorf("错误文案应统一为「%s」，得到 %s", publicShareGone, w.Body.String())
	}

	// 格式不对的 Token 也是同一个 404
	if code := contentReq(t, r, http.MethodGet, "/public/contents/short", nil).Code; code != http.StatusNotFound {
		t.Errorf("非法 Token 应 404，得到 %d", code)
	}

	// 正常响应同样带头
	shared := decodeBody[model.Content](t, contentReq(t, r, http.MethodPost, "/contents/"+itoa(int(item.ID))+"/share", map[string]any{"expiresInDays": 7}))
	ok := contentReq(t, r, http.MethodGet, "/public/contents/"+strings.TrimPrefix(shared.SharePath, "/share/"), nil)
	if got := ok.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("成功响应 Cache-Control = %q", got)
	}
}

func TestShareTokenShape(t *testing.T) {
	lowerHex := regexp.MustCompile(`^[0-9a-f]{64}$`)
	a, err := newShareToken()
	if err != nil {
		t.Fatalf("生成 Token 失败: %v", err)
	}
	b, err := newShareToken()
	if err != nil {
		t.Fatalf("生成 Token 失败: %v", err)
	}
	if !lowerHex.MatchString(a) {
		t.Errorf("Token 应为 64 位小写十六进制，得到 %q", a)
	}
	if a == b {
		t.Error("两次生成不应相同")
	}
}

func TestRotateRequiresActiveShare(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newShareRouter(h)
	item := createTestContent(t, h)
	base := "/contents/" + itoa(int(item.ID))

	if code := contentReq(t, r, http.MethodPost, base+"/share/rotate", nil).Code; code != http.StatusBadRequest {
		t.Errorf("没有分享时轮换应 400，得到 %d", code)
	}

	// 过期后也不能轮换，必须重新生成
	contentReq(t, r, http.MethodPost, base+"/share", map[string]any{"expiresInDays": 7})
	past := time.Now().AddDate(0, 0, -1)
	h.DB.Model(&model.Content{}).Where("id = ?", item.ID).Update("share_expires_at", past)
	if code := contentReq(t, r, http.MethodPost, base+"/share/rotate", nil).Code; code != http.StatusBadRequest {
		t.Errorf("过期后轮换应 400，得到 %d", code)
	}
}

func TestShareRejectsInvalidExpiry(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newShareRouter(h)
	item := createTestContent(t, h)
	if code := contentReq(t, r, http.MethodPost, "/contents/"+itoa(int(item.ID))+"/share", map[string]any{"expiresInDays": 5}).Code; code != http.StatusBadRequest {
		t.Errorf("非法有效期应 400，得到 %d", code)
	}
}

func newContentAdminRouter(h *Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/attachments", h.ListAttachments)
	r.GET("/search", h.Search)
	r.DELETE("/contents/:id", h.DeleteContent)
	r.DELETE("/projects/:id", h.DeleteProject)
	r.DELETE("/clients/:id", h.DeleteClient)
	r.DELETE("/ideas/:id", h.DeleteIdea)
	r.POST("/contents/:id/share", h.ShareContent)
	r.GET("/public/contents/:token", h.GetPublicContent)
	return r
}

func TestAttachmentContentFilter(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentAdminRouter(h)
	a := createTestContent(t, h)
	b := createTestContent(t, h)

	h.DB.Create(&model.Attachment{Hash: strings.Repeat("a", 64), Name: "a.png", Mime: "image/png", ContentID: &a.ID})
	h.DB.Create(&model.Attachment{Hash: strings.Repeat("b", 64), Name: "b.png", Mime: "image/png", ContentID: &b.ID})

	w := contentReq(t, r, http.MethodGet, "/attachments?contentId="+itoa(int(a.ID)), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("查询附件失败: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Items []model.Attachment `json:"items"`
		Count int                `json:"count"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if out.Count != 1 || len(out.Items) != 1 {
		t.Fatalf("应只返回 1 张图，得到 %+v", out)
	}
	if out.Items[0].ContentID == nil || *out.Items[0].ContentID != a.ID {
		t.Errorf("返回了别的内容的图片: %+v", out.Items[0])
	}
}

func TestDeleteContentRemovesAttachments(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentAdminRouter(h)
	item := createTestContent(t, h)

	hash, path := writeFakeImage(t, h, "content-attachment")
	h.DB.Create(&model.Attachment{
		Hash: hash, Name: "x.png", Mime: "image/png", ContentID: &item.ID,
	})

	shared := decodeBody[model.Content](t, contentReq(t, r, http.MethodPost, "/contents/"+itoa(int(item.ID))+"/share", map[string]any{"expiresInDays": 7}))
	token := strings.TrimPrefix(shared.SharePath, "/share/")

	if code := contentReq(t, r, http.MethodDelete, "/contents/"+itoa(int(item.ID)), nil).Code; code != http.StatusOK {
		t.Fatalf("删除失败: %d", code)
	}

	var n int64
	h.DB.Model(&model.Attachment{}).Where("content_id = ?", item.ID).Count(&n)
	if n != 0 {
		t.Errorf("附件记录应被清理，还剩 %d", n)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("磁盘文件应被删除")
	}
	if code := contentReq(t, r, http.MethodGet, "/public/contents/"+token, nil).Code; code != http.StatusNotFound {
		t.Errorf("删除后公开链接应 404，得到 %d", code)
	}
}

func TestDeleteProjectClearsContentRef(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentAdminRouter(h)

	p := model.Project{Name: "要删除的项目"}
	h.DB.Create(&p)
	item := createTestContent(t, h)
	h.DB.Model(&item).Update("project_id", p.ID)

	if code := contentReq(t, r, http.MethodDelete, "/projects/"+itoa(int(p.ID)), nil).Code; code != http.StatusOK {
		t.Fatalf("删除项目失败: %d", code)
	}
	var fresh model.Content
	h.DB.First(&fresh, item.ID)
	if fresh.ProjectID != nil {
		t.Errorf("项目删除后关联应置空，得到 %v", *fresh.ProjectID)
	}
}

func TestDeleteClientClearsContentRef(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentAdminRouter(h)

	c := model.Client{Name: "要删除的客户"}
	h.DB.Create(&c)
	item := createTestContent(t, h)
	h.DB.Model(&item).Update("client_id", c.ID)

	if code := contentReq(t, r, http.MethodDelete, "/clients/"+itoa(int(c.ID)), nil).Code; code != http.StatusOK {
		t.Fatalf("删除客户失败: %d", code)
	}
	var fresh model.Content
	h.DB.First(&fresh, item.ID)
	if fresh.ClientID != nil {
		t.Errorf("客户删除后关联应置空，得到 %v", *fresh.ClientID)
	}
}

func TestDeleteIdeaClearsContentRef(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentAdminRouter(h)

	idea := model.Idea{Title: "来源灵感", Status: "inbox"}
	h.DB.Create(&idea)
	item := createTestContent(t, h)
	h.DB.Model(&item).Update("source_idea_id", idea.ID)

	if code := contentReq(t, r, http.MethodDelete, "/ideas/"+itoa(int(idea.ID)), nil).Code; code != http.StatusOK {
		t.Fatalf("删除灵感失败: %d", code)
	}
	var fresh model.Content
	h.DB.First(&fresh, item.ID)
	if fresh.SourceIdeaID != nil {
		t.Errorf("灵感删除后来源关联应置空，得到 %v", *fresh.SourceIdeaID)
	}
}

func TestSearchIncludesContents(t *testing.T) {
	h, _ := newTestHandler(t)
	r := newContentAdminRouter(h)
	createTestContent(t, h)

	w := contentReq(t, r, http.MethodGet, "/search?q=%E5%A4%87%E6%A1%88", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("搜索失败: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Contents []model.Content `json:"contents"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(out.Contents) != 1 {
		t.Fatalf("应搜到 1 条内容，得到 %d", len(out.Contents))
	}
	if out.Contents[0].Title != "微信小程序备案被驳回的 3 个原因" {
		t.Errorf("标题不对: %q", out.Contents[0].Title)
	}
	if out.Contents[0].Kind != "pitfall" || out.Contents[0].Status != "draft" {
		t.Errorf("类型/状态不对: %s / %s", out.Contents[0].Kind, out.Contents[0].Status)
	}
	if len(out.Contents[0].TagList) != 2 {
		t.Errorf("应回填标签数组，得到 %v", out.Contents[0].TagList)
	}

	// 空查询也要返回 contents 空数组，前端不能拿到 null
	empty := contentReq(t, r, http.MethodGet, "/search?q=", nil)
	var raw map[string]any
	json.Unmarshal(empty.Body.Bytes(), &raw)
	if v, ok := raw["contents"].([]any); !ok || len(v) != 0 {
		t.Errorf("空查询 contents 应为空数组，得到 %#v", raw["contents"])
	}
}

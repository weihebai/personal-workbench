package handler

import "testing"

func TestGuessSource(t *testing.T) {
	cases := map[string]string{
		"https://mp.weixin.qq.com/s/abc":        "wechat",
		"https://github.com/ggerganov/llama.cpp": "github",
		"https://gitee.com/foo/bar":              "github",
		"https://www.bilibili.com/video/BV1xx":   "video",
		"https://example.com/post/1":             "article",
		"":                                       "note",
	}
	for url, want := range cases {
		if got := guessSource(url); got != want {
			t.Errorf("guessSource(%q) = %q, want %q", url, got, want)
		}
	}
}

func TestDeriveTitle(t *testing.T) {
	// 有标题就用标题
	if got := deriveTitle(ideaInput{Title: "  我的标题  ", URL: "https://a.com"}); got != "我的标题" {
		t.Errorf("应取原标题，得到 %q", got)
	}

	// 只有链接 → 用去掉协议的链接
	got := deriveTitle(ideaInput{URL: "https://www.example.com/a/b"})
	if got != "example.com/a/b" {
		t.Errorf("应去掉协议和 www，得到 %q", got)
	}

	// 只有正文 → 用正文开头
	if got := deriveTitle(ideaInput{Content: "一段想法"}); got != "一段想法" {
		t.Errorf("应取正文开头，得到 %q", got)
	}

	// 只有备注 → 用备注兜底
	if got := deriveTitle(ideaInput{Note: "随口一记"}); got != "随口一记" {
		t.Errorf("应取备注，得到 %q", got)
	}

	// 正文超长要截断
	long := make([]rune, 300)
	for i := range long {
		long[i] = 'a'
	}
	if n := len([]rune(deriveTitle(ideaInput{Content: string(long)}))); n != ideaTitleMax {
		t.Errorf("超长正文应截断到 %d，实际 %d", ideaTitleMax, n)
	}
}

// 中文标题必须按字符截断，按字节截会切出乱码
func TestDeriveTitleChineseTruncate(t *testing.T) {
	long := ""
	for i := 0; i < 200; i++ {
		long += "灵"
	}
	got := deriveTitle(ideaInput{Content: long})
	if n := len([]rune(got)); n != ideaTitleMax {
		t.Fatalf("中文应截断到 %d 个字符，实际 %d", ideaTitleMax, n)
	}
	for _, r := range got {
		if r != '灵' {
			t.Fatalf("截断产生了乱码字符 %q", r)
		}
	}
}

func TestNormalizeIdea(t *testing.T) {
	in := ideaInput{URL: "  https://mp.weixin.qq.com/s/x  ", Star: 9}
	normalizeIdea(&in)
	if in.URL != "https://mp.weixin.qq.com/s/x" {
		t.Errorf("URL 应 trim，得到 %q", in.URL)
	}
	if in.Source != "wechat" {
		t.Errorf("来源应自动识别为 wechat，得到 %q", in.Source)
	}
	if in.Status != "inbox" {
		t.Errorf("默认状态应为 inbox，得到 %q", in.Status)
	}
	if in.Star != 3 {
		t.Errorf("星级应封顶在 3，得到 %v", in.Star)
	}
}

func TestSplitTags(t *testing.T) {
	got := splitTags(" AI, 前端 ,, 副业 ")
	want := []string{"AI", "前端", "副业"}
	if len(got) != len(want) {
		t.Fatalf("应有 %d 个标签，得到 %v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("标签 %d 应为 %q，得到 %q", i, want[i], got[i])
		}
	}
	// 空输入必须是空切片而非 nil，否则前端遍历会崩
	if empty := splitTags(""); empty == nil {
		t.Fatal("空输入应返回空切片，不能是 nil")
	}
}

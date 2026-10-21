package handler

import (
	"testing"
)

// 批量录入时用户习惯带编号或列表符号，拆分要能吃掉它们，
// 否则步骤标题里会带着 "1." 这种噪音。
func TestTrimListMarker(t *testing.T) {
	cases := []struct{ in, want string }{
		{"1. 上传代码", "上传代码"},
		{"2、域名访问", "域名访问"},
		{"3.完善信息", "完善信息"},
		{"4) 测试支付功能", "测试支付功能"},
		{"- 上传代码", "上传代码"},
		{"* 域名访问", "域名访问"},
		{"• 完善信息", "完善信息"},
		{"✓ 测试支付", "测试支付"},
		{"上传代码", "上传代码"},        // 没有符号，原样保留
		{"   上传代码   ", "上传代码"},   // 前后空白要 trim
		{"2026 年上线", "2026 年上线"}, // 数字开头但不是列表，不能把 "2026" 当编号吃掉
		{"1.", "1."},             // 只有编号没有内容，保持原样
		{"", ""},
	}
	for _, c := range cases {
		if got := trimListMarker(c.in); got != c.want {
			t.Errorf("trimListMarker(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestToFloat(t *testing.T) {
	if v, ok := toFloat(float64(3)); !ok || v != 3 {
		t.Fatal("float64 转换失败")
	}
	if _, ok := toFloat("abc"); ok {
		t.Fatal("字符串不该被当成数字")
	}
}

func TestToString(t *testing.T) {
	if s := toString("hi"); s != "hi" {
		t.Fatal("字符串转换失败")
	}
	if s := toString(1); s != "" {
		t.Fatal("非字符串应返回空")
	}
}

func TestHumanSize(t *testing.T) {
	cases := []struct {
		n    int64
		want string
	}{
		{512, "512 B"},
		{2048, "2 KB"},
		{5 * 1024 * 1024, "5 MB"},
	}
	for _, c := range cases {
		if got := humanSize(c.n); got != c.want {
			t.Errorf("humanSize(%d) = %q, want %q", c.n, got, c.want)
		}
	}
}

func TestTruncate(t *testing.T) {
	if got := truncate("abcdef", 3); got != "abc" {
		t.Errorf("截断失败: %q", got)
	}
	// 中文按字符裁，不能把多字节字符切坏
	if got := truncate("中文标题超长", 3); got != "中文标" {
		t.Errorf("中文截断失败: %q", got)
	}
	if got := truncate("abc", 10); got != "abc" {
		t.Errorf("不超长应原样返回: %q", got)
	}
}

func TestParseUint(t *testing.T) {
	if v, err := parseUint("42"); err != nil || v != 42 {
		t.Fatalf("parseUint(42) = %d, %v", v, err)
	}
	for _, bad := range []string{"", "abc", "1a", "-1"} {
		if _, err := parseUint(bad); err == nil {
			t.Errorf("parseUint(%q) 应该报错", bad)
		}
	}
}

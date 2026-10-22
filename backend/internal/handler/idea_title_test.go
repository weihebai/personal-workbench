package handler

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func localClient() *http.Client {
	return newPageHTTPClient(func(ctx context.Context, network, addr string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, addr)
	})
}

func TestTitleFromHTML(t *testing.T) {
	got := titleFromHTML(strings.NewReader(
		`<html><head><title>  真实 &amp; 标题  </title></head><body></body></html>`))
	if got != "真实 & 标题" {
		t.Fatalf("title = %q, want %q", got, "真实 & 标题")
	}

	if got := titleFromHTML(strings.NewReader(`<html><body>没有标题</body></html>`)); got != "" {
		t.Fatalf("无 title 应返回空串，得到 %q", got)
	}
}

func TestClampTitle(t *testing.T) {
	long := strings.Repeat("灵", 200)
	got := clampTitle(long)
	if n := len([]rune(got)); n != ideaTitleMax {
		t.Fatalf("应截断到 %d 个字符，实际 %d", ideaTitleMax, n)
	}
}

func TestIsBlockedIP(t *testing.T) {
	cases := []struct {
		ip      string
		blocked bool
	}{
		{"127.0.0.1", true},
		{"10.0.0.1", true},
		{"172.16.0.1", true},
		{"192.168.1.1", true},
		{"169.254.169.254", true},
		{"0.0.0.0", true},
		{"::1", true},
		{"fe80::1", true},
		{"fc00::1", true},
		{"::ffff:127.0.0.1", true},
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"2606:4700:4700::1111", false},
	}
	for _, c := range cases {
		if got := isBlockedIP(net.ParseIP(c.ip)); got != c.blocked {
			t.Errorf("isBlockedIP(%s) = %v, want %v", c.ip, got, c.blocked)
		}
	}
}

func TestSafeDialContextBlocksPrivate(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:80", "169.254.169.254:80", "[::1]:80"} {
		if _, err := safeDialContext(context.Background(), "tcp", addr); err == nil {
			t.Errorf("%s 应被拒绝", addr)
		}
	}
}

func TestFetchPageTitle(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(`<html><head><title>文章标题</title></head></html>`))
		case "/json":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"title":"x"}`))
		case "/notfound":
			http.NotFound(w, r)
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		case "/file":
			w.Header().Set("Location", "file:///etc/passwd")
			w.WriteHeader(http.StatusFound)
		}
	}))
	defer srv.Close()

	client := localClient()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if got := fetchPageTitleWithClient(ctx, srv.URL+"/html", client); got != "文章标题" {
		t.Fatalf("title = %q, want 文章标题", got)
	}
	if got := fetchPageTitleWithClient(ctx, srv.URL+"/json", client); got != "" {
		t.Fatalf("非 HTML 应返回空串，得到 %q", got)
	}
	if got := fetchPageTitleWithClient(ctx, srv.URL+"/notfound", client); got != "" {
		t.Fatalf("非 2xx 应返回空串，得到 %q", got)
	}
	if got := fetchPageTitleWithClient(ctx, srv.URL+"/loop", client); got != "" {
		t.Fatalf("跳转过多应返回空串，得到 %q", got)
	}
	if got := fetchPageTitleWithClient(ctx, srv.URL+"/file", client); got != "" {
		t.Fatalf("非 http(s) 跳转应返回空串，得到 %q", got)
	}
}

// 生产客户端必须拦住指向本机的链接（测试服务器正好在本机）。
func TestFetchPageTitleBlocksLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<title>不该拿到</title>`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if got := fetchPageTitle(ctx, srv.URL); got != "" {
		t.Fatalf("本机地址应被 SSRF 防护拦截，得到 %q", got)
	}
}

func TestResolveIdeaTitleFallback(t *testing.T) {
	// 有标题不抓取
	if got := resolveIdeaTitle(context.Background(), ideaInput{Title: "手动标题", URL: "https://example.com"}); got != "手动标题" {
		t.Fatalf("应直接用手动标题，得到 %q", got)
	}
	// 没链接时退回正文
	if got := resolveIdeaTitle(context.Background(), ideaInput{Content: "一段想法"}); got != "一段想法" {
		t.Fatalf("应退回正文，得到 %q", got)
	}
	// 非法链接不发起请求，退回链接文本
	if got := resolveIdeaTitle(context.Background(), ideaInput{URL: "file:///etc/passwd"}); got != "file:///etc/passwd" {
		t.Fatalf("非法链接应退回链接文本，得到 %q", got)
	}
}

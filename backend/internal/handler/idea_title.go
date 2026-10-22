package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const (
	pageTitleTimeout = 5 * time.Second
	pageTitleMaxBody = 512 << 10
	pageTitleMaxHops = 3
)

type dialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

// pageHTTPClient 抓标题专用的客户端：不走环境代理、拒绝内网地址、
// 限制跳转次数和总耗时，避免随便一个链接把服务端拖住或探到内网。
var pageHTTPClient = newPageHTTPClient(safeDialContext)

func newPageHTTPClient(dial dialFunc) *http.Client {
	tr := &http.Transport{
		Proxy:                 nil,
		DialContext:           dial,
		TLSHandshakeTimeout:   3 * time.Second,
		ResponseHeaderTimeout: 3 * time.Second,
		DisableKeepAlives:     true,
	}
	return &http.Client{
		Transport: tr,
		Timeout:   pageTitleTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > pageTitleMaxHops {
				return errors.New("跳转次数过多")
			}
			if _, err := validatePageURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

func validatePageURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errors.New("只支持 http/https 链接")
	}
	if u.Host == "" {
		return nil, errors.New("链接缺少域名")
	}
	if u.User != nil {
		return nil, errors.New("链接不能包含账号信息")
	}
	return u, nil
}

// 这些网段不能从服务端访问：回环、内网、链路本地（含云厂商 metadata）、
// 组播、保留地址等。域名解析后逐个 IP 检查，防止用域名绕过。
var blockedIPNets = mustParseCIDRs(
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
	"169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
	"192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
	"224.0.0.0/4", "240.0.0.0/4",
	"::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32",
)

func mustParseCIDRs(cidrs ...string) []*net.IPNet {
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, s := range cidrs {
		_, n, err := net.ParseCIDR(s)
		if err != nil {
			panic(err)
		}
		out = append(out, n)
	}
	return out
}

func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	for _, n := range blockedIPNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// safeDialContext 解析域名后只拨号到公网 IP；http.Transport 仍用原域名做 TLS SNI/证书校验。
func safeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	d := net.Dialer{Timeout: 4 * time.Second}
	var lastErr error
	for _, ip := range ips {
		if isBlockedIP(ip.IP) {
			lastErr = fmt.Errorf("地址不可访问: %s", ip.IP)
			continue
		}
		conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("域名没有可用地址")
	}
	return nil, lastErr
}

// fetchPageTitle 抓取失败一律返回空串，由调用方回退到链接/正文。
func fetchPageTitle(ctx context.Context, rawURL string) string {
	return fetchPageTitleWithClient(ctx, rawURL, pageHTTPClient)
}

func fetchPageTitleWithClient(ctx context.Context, rawURL string, client *http.Client) string {
	u, err := validatePageURL(rawURL)
	if err != nil {
		return ""
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; personal-workbench/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")

	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}
	ct := resp.Header.Get("Content-Type")
	if ct != "" && !strings.Contains(strings.ToLower(ct), "html") {
		return ""
	}
	reader, err := charset.NewReader(io.LimitReader(resp.Body, pageTitleMaxBody), ct)
	if err != nil {
		return ""
	}
	return clampTitle(titleFromHTML(reader))
}

func titleFromHTML(r io.Reader) string {
	z := html.NewTokenizer(r)
	for {
		switch z.Next() {
		case html.ErrorToken:
			return ""
		case html.StartTagToken:
			name, _ := z.TagName()
			if string(name) != "title" {
				continue
			}
			var b strings.Builder
			for {
				switch z.Next() {
				case html.TextToken:
					b.Write(z.Text())
				case html.EndTagToken:
					name, _ := z.TagName()
					if string(name) == "title" {
						return strings.Join(strings.Fields(b.String()), " ")
					}
				case html.ErrorToken:
					return strings.Join(strings.Fields(b.String()), " ")
				}
			}
		}
	}
}

func clampTitle(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > ideaTitleMax {
		r = r[:ideaTitleMax]
	}
	return string(r)
}

// resolveIdeaTitle 标题为空时先抓网页 title，抓不到再退回链接/正文。
func resolveIdeaTitle(ctx context.Context, in ideaInput) string {
	if t := strings.TrimSpace(in.Title); t != "" {
		return t
	}
	if t := fetchPageTitle(ctx, in.URL); t != "" {
		return t
	}
	return deriveTitle(in)
}

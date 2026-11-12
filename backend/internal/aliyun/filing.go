package aliyun

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var ErrExpired = errors.New("阿里云登录已失效，请重新登录并更新会话")
var orderPattern = regexp.MustCompile(`^[0-9]{1,32}$`)

type Credentials struct {
	Cookies []*http.Cookie `json:"cookies"`
}

type ProgressNode struct {
	NodeID        string `json:"nodeId"`
	IsCurrentNode bool   `json:"isCurrentNode"`
	Status        int    `json:"status"`
	StatusText    string `json:"statusText"`
	Title         string `json:"title"`
	ProgressInfo  string `json:"progressInfo"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

func ValidOrderID(id string) bool { return orderPattern.MatchString(id) }

func allowedCookie(name string) bool {
	return name == "login_aliyunid_ticket" || name == "login_aliyunid_sc" || name == "JSESSIONID" || name == "BA-XSRF-TOKEN"
}

func ImportCookie(header string) (*Client, error) {
	if len(header) > 32768 || strings.ContainsAny(header, "\r\n") {
		return nil, errors.New("阿里云会话格式错误")
	}
	req := &http.Request{Header: http.Header{"Cookie": {header}}}
	return Restore(Credentials{Cookies: req.Cookies()})
}

func Restore(credentials Credentials) (*Client, error) {
	jar, _ := cookiejar.New(nil)
	client := &Client{baseURL: "https://beian.aliyun.com", http: &http.Client{
		Jar: jar, Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
	}}
	seen := map[string]bool{}
	cookies := []*http.Cookie{}
	for _, cookie := range credentials.Cookies {
		if cookie == nil || !allowedCookie(cookie.Name) {
			continue
		}
		if seen[cookie.Name] || cookie.Value == "" || len(cookie.Value) > 8192 || cookie.Valid() != nil {
			return nil, errors.New("阿里云会话格式错误")
		}
		seen[cookie.Name] = true
		cookies = append(cookies, &http.Cookie{Name: cookie.Name, Value: cookie.Value, Path: "/", Secure: true, HttpOnly: true})
	}
	if !seen["login_aliyunid_ticket"] || !seen["login_aliyunid_sc"] {
		return nil, errors.New("会话不完整，请复制备案进度请求中的完整 Cookie")
	}
	u, _ := url.Parse(client.baseURL)
	jar.SetCookies(u, cookies)
	return client, nil
}

func (c *Client) Credentials() Credentials {
	u, _ := url.Parse(c.baseURL)
	cookies := []*http.Cookie{}
	for _, cookie := range c.http.Jar.Cookies(u) {
		if allowedCookie(cookie.Name) {
			cookies = append(cookies, cookie)
		}
	}
	return Credentials{Cookies: cookies}
}

func (c *Client) Progress(ctx context.Context, orderID string) (ProgressNode, error) {
	var empty ProgressNode
	if !ValidOrderID(orderID) {
		return empty, errors.New("阿里云订单号应为 1 至 32 位数字")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/confirm/progress.json?baOrderId="+url.QueryEscape(orderID), nil)
	if err != nil {
		return empty, errors.New("创建阿里云查询失败")
	}
	req.Header.Set("Referer", c.baseURL+"/pcContainer/orderdetail?baOrderId="+orderID)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := c.http.Do(req)
	if err != nil {
		return empty, errors.New("连接阿里云失败，请稍后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return empty, fmt.Errorf("阿里云查询失败（HTTP %d），请检查登录与查看权限", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil || len(data) > 2<<20 {
		return empty, errors.New("读取阿里云响应失败")
	}
	var response struct {
		Code       int    `json:"code"`
		ResultCode string `json:"resultCode"`
		Data       *struct {
			BaOrderID string `json:"baOrderId"`
			Progress  []struct {
				ProgressNode
				Status *int `json:"status"`
			} `json:"progress"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &response) != nil {
		return empty, errors.New("阿里云进度响应格式异常，请稍后重试")
	}
	if response.ResultCode == "Frontend.Business.NeedLogin" {
		return empty, ErrExpired
	}
	if response.Code != 200 || response.ResultCode != "Success" {
		return empty, errors.New("阿里云未返回有效进度，请检查订单号、查看权限或稍后重试")
	}
	if response.Data == nil || response.Data.BaOrderID != orderID {
		return empty, errors.New("阿里云返回的备案订单不匹配")
	}
	var current *ProgressNode
	for _, node := range response.Data.Progress {
		if !node.IsCurrentNode {
			continue
		}
		if current != nil || node.Status == nil || node.NodeID == "" || node.Title == "" || node.StatusText == "" {
			return empty, errors.New("阿里云当前审核节点格式异常")
		}
		value := node.ProgressNode
		value.Status = *node.Status
		current = &value
	}
	if current == nil {
		return empty, errors.New("阿里云未返回当前审核节点")
	}
	return *current, nil
}

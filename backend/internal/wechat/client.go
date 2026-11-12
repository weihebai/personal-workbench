package wechat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

var ErrExpired = errors.New("微信登录已失效，请重新扫码")

type Credentials struct {
	Token   string         `json:"token"`
	Cookies []*http.Cookie `json:"cookies"`
}

type FilingInfo struct {
	Status     int    `json:"status"`
	StatusText string `json:"statusText"`
}

type Client struct {
	http    *http.Client
	baseURL string
	token   string
}

func NewClient() *Client {
	jar, _ := cookiejar.New(nil)
	return &Client{baseURL: "https://mp.weixin.qq.com", http: &http.Client{
		Jar: jar, Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 || req.URL.Host != via[0].URL.Host || req.URL.Scheme != via[0].URL.Scheme {
				return errors.New("微信返回了异常跳转")
			}
			return nil
		},
	}}
}

func Restore(credentials Credentials) (*Client, error) {
	if credentials.Token == "" || len(credentials.Cookies) == 0 {
		return nil, ErrExpired
	}
	c := NewClient()
	c.token = credentials.Token
	u, _ := url.Parse(c.baseURL)
	c.http.Jar.SetCookies(u, credentials.Cookies)
	return c, nil
}

func (c *Client) Credentials() (Credentials, error) {
	if c.token == "" {
		return Credentials{}, ErrExpired
	}
	u, _ := url.Parse(c.baseURL)
	return Credentials{Token: c.token, Cookies: c.http.Jar.Cookies(u)}, nil
}

func (c *Client) request(ctx context.Context, path string, form url.Values) ([]byte, string, error) {
	method := http.MethodGet
	var body io.Reader
	if form != nil {
		method = http.MethodPost
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, "", errors.New("创建微信请求失败")
	}
	req.Header.Set("Referer", c.baseURL+"/")
	req.Header.Set("User-Agent", "Mozilla/5.0")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", errors.New("连接微信失败，请稍后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("微信请求失败（HTTP %d）", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20+1))
	if err != nil || len(data) > 2<<20 {
		return nil, "", errors.New("读取微信响应失败")
	}
	return data, resp.Header.Get("Content-Type"), nil
}

type loginResponse struct {
	BaseResp *struct {
		Ret int `json:"ret"`
	} `json:"base_resp"`
	Status      *int   `json:"status"`
	RedirectURL string `json:"redirect_url"`
}

func decodeLogin(data []byte) (loginResponse, error) {
	var response loginResponse
	if json.Unmarshal(data, &response) != nil || response.BaseResp == nil {
		return response, errors.New("微信登录响应格式异常")
	}
	if response.BaseResp.Ret != 0 {
		return response, fmt.Errorf("微信登录失败（错误码 %d），请重新生成二维码", response.BaseResp.Ret)
	}
	return response, nil
}

func (c *Client) StartLogin(ctx context.Context) ([]byte, string, error) {
	if _, _, err := c.request(ctx, "/", nil); err != nil {
		return nil, "", err
	}
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return nil, "", err
	}
	data, _, err := c.request(ctx, "/cgi-bin/bizlogin?action=startlogin", url.Values{
		"userlang": {"zh_CN"}, "redirect_url": {""}, "login_type": {"3"}, "sessionid": {hex.EncodeToString(buf[:])},
	})
	if err != nil {
		return nil, "", err
	}
	if _, err = decodeLogin(data); err != nil {
		return nil, "", err
	}
	image, mime, err := c.request(ctx, "/cgi-bin/scanloginqrcode?action=getqrcode", nil)
	if err != nil {
		return nil, "", err
	}
	if mime != "image/jpeg" && mime != "image/jpg" && mime != "image/png" {
		return nil, "", errors.New("微信未返回二维码图片，请重试")
	}
	return image, mime, nil
}

func (c *Client) PollLogin(ctx context.Context) (string, error) {
	if c.token != "" {
		return "confirmed", nil
	}
	data, _, err := c.request(ctx, "/cgi-bin/scanloginqrcode?action=ask", nil)
	if err != nil {
		return "", err
	}
	response, err := decodeLogin(data)
	if err != nil {
		return "", err
	}
	if response.Status == nil {
		return "", errors.New("微信未返回扫码状态")
	}
	switch *response.Status {
	case 0:
		return "waiting", nil
	case 2, 3:
		return "expired", nil
	case 4, 6:
		return "scanned", nil
	case 5:
		return "", errors.New("当前微信账号无法完成登录，请在微信端检查账号权限")
	case 1:
		data, _, err = c.request(ctx, "/cgi-bin/bizlogin?action=login", url.Values{
			"userlang": {"zh_CN"}, "redirect_url": {""}, "login_type": {"3"},
			"cookie_forbidden": {"0"}, "cookie_cleaned": {"0"}, "plugin_used": {"0"},
		})
		if err != nil {
			return "", err
		}
		response, err = decodeLogin(data)
		if err != nil {
			return "", err
		}
		u, err := url.Parse(response.RedirectURL)
		if err != nil || response.RedirectURL == "" {
			return "", errors.New("微信未返回登录跳转地址")
		}
		base, _ := url.Parse(c.baseURL)
		u = base.ResolveReference(u)
		if u.Host != base.Host || u.Scheme != base.Scheme {
			return "", errors.New("微信返回了异常登录跳转")
		}
		token := u.Query().Get("token")
		if token == "" {
			return "", errors.New("微信登录需要额外验证，请在微信端完成确认后重试")
		}
		if !strings.HasPrefix(u.Path, "/wxamp/") {
			return "", errors.New("请选择需要监控的微信小程序账号")
		}
		if _, _, err = c.request(ctx, u.RequestURI(), nil); err != nil {
			return "", err
		}
		c.token = token
		return "confirmed", nil
	default:
		return "", fmt.Errorf("未知扫码状态 %d，请重新生成二维码", *response.Status)
	}
}

func (c *Client) Filing(ctx context.Context) (FilingInfo, error) {
	var info FilingInfo
	if c.token == "" {
		return info, ErrExpired
	}
	path := "/wxopen/initprofile?" + url.Values{"action": {"home"}, "f": {"json"}, "token": {c.token}, "lang": {"zh_CN"}}.Encode()
	data, _, err := c.request(ctx, "/wxamp/cgi/route?"+url.Values{"path": {path}, "token": {c.token}}.Encode(), nil)
	if err != nil {
		return info, err
	}
	var response struct {
		Ret     *int `json:"ret"`
		ICPInfo *struct {
			Status *int `json:"status"`
		} `json:"icp_info"`
	}
	if json.Unmarshal(data, &response) != nil || response.Ret == nil {
		return info, errors.New("微信备案响应格式异常")
	}
	if *response.Ret == 200003 {
		return info, ErrExpired
	}
	if *response.Ret != 0 {
		return info, fmt.Errorf("微信备案查询失败（错误码 %d）", *response.Ret)
	}
	if response.ICPInfo == nil || response.ICPInfo.Status == nil {
		return info, errors.New("微信未返回备案状态，请确认登录的是小程序账号")
	}
	info.Status = *response.ICPInfo.Status
	labels := map[int]string{0: "未备案", 1: "未备案", 2: "平台审核中", 3: "平台驳回", 4: "管局审核中", 5: "管局驳回", 6: "已完成"}
	text, ok := labels[info.Status]
	if !ok {
		return info, fmt.Errorf("未知备案状态 %d", info.Status)
	}
	info.StatusText = text
	return info, nil
}

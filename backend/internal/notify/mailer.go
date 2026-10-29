// Package notify 负责把邮件发出去：SMTP 连接、鉴权和消息体组装。
// 配置来自设置表（见 handler/mail.go），这里不读数据库。
package notify

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	To       []string
	// SSL：465 这类隐式 TLS 端口。填 false 时按服务器能力走 STARTTLS。
	SSL bool
}

func (c Config) addr() string {
	port := c.Port
	if port == 0 {
		port = 587
	}
	return net.JoinHostPort(c.Host, strconv.Itoa(port))
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.Host) == "" {
		return fmt.Errorf("SMTP 服务器不能为空")
	}
	if strings.TrimSpace(c.From) == "" {
		return fmt.Errorf("发件人不能为空")
	}
	if len(c.To) == 0 {
		return fmt.Errorf("收件人不能为空")
	}
	return nil
}

func (c Config) auth() smtp.Auth {
	if c.Username == "" {
		return nil
	}
	return smtp.PlainAuth("", c.Username, c.Password, c.Host)
}

// connect 建立连接并完成 TLS / AUTH，Check 和 Send 共用。
func connect(cfg Config) (*smtp.Client, error) {
	conn, err := net.DialTimeout("tcp", cfg.addr(), 15*time.Second)
	if err != nil {
		return nil, err
	}
	// SMTP 的读写没有自带超时，服务端卡住时后台任务会一直挂着
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	if cfg.SSL {
		conn = tls.Client(conn, &tls.Config{ServerName: cfg.Host})
	}
	client, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if !cfg.SSL {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
				client.Close()
				return nil, err
			}
		}
	}
	if auth := cfg.auth(); auth != nil {
		if err := client.Auth(auth); err != nil {
			client.Close()
			return nil, fmt.Errorf("SMTP 登录失败：%w", err)
		}
	}
	return client, nil
}

// Check 只验证连接与登录，不发邮件。
func Check(cfg Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	client, err := connect(cfg)
	if err != nil {
		return err
	}
	return client.Quit()
}

// Send 发一封纯文本邮件。
func Send(cfg Config, subject, body string) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	client, err := connect(cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	if err := client.Mail(envelopeAddress(cfg.From)); err != nil {
		return err
	}
	for _, to := range cfg.To {
		if err := client.Rcpt(envelopeAddress(to)); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(buildMessage(cfg, subject, body)); err != nil {
		w.Close()
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func buildMessage(cfg Config, subject, body string) []byte {
	var b strings.Builder
	b.WriteString("From: " + formatAddress(cfg.From) + "\r\n")
	b.WriteString("To: " + strings.Join(cfg.To, ", ") + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")

	encoded := base64.StdEncoding.EncodeToString([]byte(body))
	for len(encoded) > 76 {
		b.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	b.WriteString(encoded + "\r\n")
	return []byte(b.String())
}

// formatAddress 把「显示名 <地址>」里的显示名做 RFC 2047 编码。
// 邮件头不能直接放中文，否则部分 SMTP 服务会拒收或把发件人显示成乱码。
func formatAddress(s string) string {
	s = strings.TrimSpace(s)
	i := strings.LastIndex(s, "<")
	if i < 0 {
		return s
	}
	name := strings.Trim(strings.TrimSpace(s[:i]), `"`)
	addr := strings.TrimSpace(strings.TrimSuffix(s[i:], ">"))
	if name == "" {
		return "<" + addr + ">"
	}
	return mime.QEncoding.Encode("utf-8", name) + " <" + addr + ">"
}

// envelopeAddress 取信封发件人：SMTP 的 MAIL FROM 只接受地址本身，不能带显示名。
func envelopeAddress(s string) string {
	if i := strings.LastIndex(s, "<"); i >= 0 {
		return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s[i+1:]), ">"))
	}
	return strings.TrimSpace(s)
}

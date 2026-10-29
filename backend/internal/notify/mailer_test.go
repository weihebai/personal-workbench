package notify

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestBuildMessage(t *testing.T) {
	cfg := Config{From: "工作台 <me@example.com>", To: []string{"a@example.com", "b@example.com"}}
	msg := string(buildMessage(cfg, "工作台提醒：2 项到期", "第一行\n第二行"))

	for _, want := range []string{
		"From: =?utf-8?q?",
		"<me@example.com>",
		"To: a@example.com, b@example.com",
		"Subject: =?utf-8?q?",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
	} {
		if !strings.Contains(msg, want) {
			t.Fatalf("邮件头缺少 %q:\n%s", want, msg)
		}
	}

	body := msg[strings.Index(msg, "\r\n\r\n")+4:]
	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.TrimSpace(body), "\r\n", ""))
	if err != nil {
		t.Fatalf("正文不是合法 base64: %v", err)
	}
	if string(decoded) != "第一行\n第二行" {
		t.Fatalf("正文解码不一致: %q", string(decoded))
	}
}

func TestEnvelopeAddress(t *testing.T) {
	cases := map[string]string{
		"me@example.com":               "me@example.com",
		"工作台 <me@example.com>":         "me@example.com",
		`"Workbench" <me@example.com>`: "me@example.com",
	}
	for in, want := range cases {
		if got := envelopeAddress(in); got != want {
			t.Fatalf("envelopeAddress(%q) = %q，期望 %q", in, got, want)
		}
	}
}

func TestConfigValidate(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
	}{
		{"缺服务器", Config{From: "from", To: []string{"to"}}},
		{"缺发件人", Config{Host: "smtp.example.com", To: []string{"to"}}},
		{"缺收件人", Config{Host: "smtp.example.com", From: "from"}},
	}
	for _, c := range cases {
		if err := c.cfg.Validate(); err == nil {
			t.Fatalf("%s 应该校验失败", c.name)
		}
	}
	if err := (Config{Host: "smtp.example.com", From: "from", To: []string{"to"}}).Validate(); err != nil {
		t.Fatalf("完整配置不应报错: %v", err)
	}
}

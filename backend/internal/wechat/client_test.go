package wechat

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestLiveScanQRCode(t *testing.T) {
	if os.Getenv("WECHAT_LIVE_TEST") != "1" {
		t.Skip("仅在显式启用时请求微信二维码")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	imageData, _, err := NewClient().StartLogin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(imageData))
	if err != nil || config.Width < 100 || config.Height < 100 {
		t.Fatalf("invalid QR image: %+v %v", config, err)
	}
}

func TestScanLoginPreservesCookiesAndCapturesToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			http.SetCookie(w, &http.Cookie{Name: "seed", Value: "abc", Path: "/"})
		case "/cgi-bin/bizlogin":
			if c, err := r.Cookie("seed"); err != nil || c.Value != "abc" {
				t.Error("login lost seed cookie")
			}
			if r.URL.Query().Get("action") == "startlogin" {
				r.ParseForm()
				if r.Form.Get("login_type") != "3" {
					t.Error("not scan login")
				}
				w.Write([]byte(`{"base_resp":{"ret":0},"uuid":"qr-session"}`))
			} else {
				http.SetCookie(w, &http.Cookie{Name: "slave_sid", Value: "private-session", Path: "/"})
				w.Write([]byte(`{"base_resp":{"ret":0},"redirect_url":"/wxamp/home/guide?token=123456"}`))
			}
		case "/cgi-bin/scanloginqrcode":
			if r.URL.Query().Get("action") == "getqrcode" {
				w.Header().Set("Content-Type", "image/jpeg")
				w.Write([]byte("qr-image"))
			} else {
				w.Write([]byte(`{"base_resp":{"ret":0},"status":1}`))
			}
		case "/wxamp/home/guide":
			if _, err := r.Cookie("slave_sid"); err != nil {
				t.Error("missing login cookie")
			}
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()
	c := NewClient()
	c.baseURL = srv.URL
	image, mime, err := c.StartLogin(context.Background())
	if err != nil || string(image) != "qr-image" || mime != "image/jpeg" {
		t.Fatalf("QR: %q %s %v", image, mime, err)
	}
	state, err := c.PollLogin(context.Background())
	if err != nil || state != "confirmed" {
		t.Fatalf("login: %s %v", state, err)
	}
	credentials, err := c.Credentials()
	if err != nil || credentials.Token != "123456" || len(credentials.Cookies) == 0 {
		t.Fatalf("credentials not captured: %v", err)
	}
}

func TestFilingRejectsInvalidResponsesAndRecognizesExpiredSession(t *testing.T) {
	for _, tc := range []struct {
		name, body     string
		expired, valid bool
	}{
		{"success", `{"ret":0,"icp_info":{"status":4}}`, false, true},
		{"expired", `{"ret":200003}`, true, false},
		{"missing status", `{"ret":0,"icp_info":{}}`, false, false},
		{"missing ret", `{"icp_info":{"status":4}}`, false, false},
		{"login html", `<html>login</html>`, false, false},
		{"unknown status", `{"ret":0,"icp_info":{"status":99}}`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("token") != "123" {
					t.Error("missing token")
				}
				path, err := url.Parse(r.URL.Query().Get("path"))
				if err != nil || path.Path != "/wxopen/initprofile" || path.Query().Get("token") != "123" || path.Query().Get("action") != "home" {
					t.Error("wrong routed path")
				}
				w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			c := NewClient()
			c.baseURL = srv.URL
			c.token = "123"
			info, err := c.Filing(context.Background())
			if tc.valid {
				if err != nil || info.Status != 4 || info.StatusText != "管局审核中" {
					t.Fatalf("wrong filing result: %+v %v", info, err)
				}
			} else if err == nil {
				t.Fatal("invalid response accepted")
			}
			if errors.Is(err, ErrExpired) != tc.expired {
				t.Fatalf("wrong expiration classification: %v", err)
			}
		})
	}
}

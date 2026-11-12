package aliyun

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const testCookie = "login_aliyunid_ticket=test-ticket; login_aliyunid_sc=test-session"

func TestProgressUsesSessionAndRetainsRefreshedCookie(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/confirm/progress.json" || r.URL.Query().Get("baOrderId") != "123456" {
			t.Errorf("unexpected request: %s", r.URL)
		}
		if cookie, err := r.Cookie("login_aliyunid_ticket"); err != nil || cookie.Value != "test-ticket" {
			t.Error("missing imported session")
		}
		http.SetCookie(w, &http.Cookie{Name: "login_aliyunid_sc", Value: "refreshed-session", Path: "/"})
		w.Write([]byte(`{"code":200,"message":"成功","resultCode":"Success","data":{"baOrderId":"123456","gmtCreated":"2026-10-14 14:39","progress":[{"nodeId":"FIRST_AUDIT","isCurrentNode":false,"status":30,"statusText":"已通过","title":"阿里云初审","progressInfo":"2026-10-17 13:42","icon":"","subTitle":"","tip":"","operation":"","expectFinishTime":""},{"nodeId":"ICP_AUDIT","isCurrentNode":true,"status":20,"statusText":"审核中","title":"管局审核","progressInfo":"已提交管局18个工作日","icon":"","subTitle":"","tip":"","operation":"","expectFinishTime":""}]}}`))
	}))
	defer server.Close()
	client, err := ImportCookie(testCookie + "; unrelated=discard-me")
	if err != nil {
		t.Fatal(err)
	}
	credentials := client.Credentials()
	client.baseURL = server.URL
	u, _ := url.Parse(server.URL)
	client.http.Jar.SetCookies(u, credentials.Cookies)
	info, err := client.Progress(t.Context(), "123456")
	if err != nil || info.NodeID != "ICP_AUDIT" || info.Status != 20 || info.Title != "管局审核" || info.StatusText != "审核中" || info.ProgressInfo != "已提交管局18个工作日" {
		t.Fatalf("wrong current node: %+v %v", info, err)
	}
	credentials = client.Credentials()
	updated := false
	for _, cookie := range credentials.Cookies {
		if cookie.Name == "unrelated" {
			t.Fatal("stored unrelated browser cookie")
		}
		if cookie.Name == "login_aliyunid_sc" && cookie.Value == "refreshed-session" {
			updated = true
		}
	}
	if !updated {
		t.Fatal("session refresh not retained")
	}
	restored, err := Restore(credentials)
	if err != nil || len(restored.Credentials().Cookies) < 2 {
		t.Fatalf("cannot restore refreshed credentials: %v", err)
	}
}

func TestImportCookieRejectsIncompleteOrAmbiguousSessions(t *testing.T) {
	for _, header := range []string{"", "login_aliyunid_sc=only", "login_aliyunid_ticket=only", testCookie + "; login_aliyunid_sc=duplicate", testCookie + "\r\nX-Test: invalid"} {
		if _, err := ImportCookie(header); err == nil {
			t.Fatal("invalid session accepted")
		}
	}
}

func TestProgressRejectsInvalidResultsWithoutExposingSecrets(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		expired    bool
	}{
		{"need login", `{"code":201,"resultCode":"Frontend.Business.NeedLogin","message":"test-ticket"}`, true},
		{"forbidden", `{"code":403,"resultCode":"Forbidden","message":"test-ticket"}`, false},
		{"html", `<html>test-ticket</html>`, false},
		{"missing status", `{"code":200,"resultCode":"Success","data":{"baOrderId":"123456","progress":[{"nodeId":"ICP_AUDIT","isCurrentNode":true,"title":"管局审核","statusText":"审核中"}]}}`, false},
		{"wrong order", `{"code":200,"resultCode":"Success","data":{"baOrderId":"999","progress":[]}}`, false},
		{"no current node", `{"code":200,"resultCode":"Success","data":{"baOrderId":"123456","progress":[]}}`, false},
		{"multiple current nodes", `{"code":200,"resultCode":"Success","data":{"baOrderId":"123456","progress":[{"nodeId":"A","title":"初审","status":20,"statusText":"审核中","isCurrentNode":true},{"nodeId":"B","title":"管局","status":20,"statusText":"审核中","isCurrentNode":true}]}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(tc.body)) }))
			defer server.Close()
			client, _ := ImportCookie(testCookie)
			client.baseURL = server.URL
			_, err := client.Progress(t.Context(), "123456")
			if err == nil || errors.Is(err, ErrExpired) != tc.expired || strings.Contains(err.Error(), "test-ticket") {
				t.Fatalf("wrong error classification or credential exposure: %v", err)
			}
		})
	}
}

func TestProgressDoesNotFollowRedirectOrRequestInvalidOrder(t *testing.T) {
	redirectTargetReached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirectTargetReached = true }))
	defer target.Close()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer server.Close()
	client, _ := ImportCookie(testCookie)
	client.baseURL = server.URL
	if _, err := client.Progress(t.Context(), "123&other=1"); err == nil || requests != 0 {
		t.Fatal("invalid order reached upstream")
	}
	if _, err := client.Progress(t.Context(), "123456"); err == nil || redirectTargetReached {
		t.Fatal("followed upstream redirect")
	}
}

// 独立 MCP 服务器，提供两种传输方式，工具集相同（见 internal/mcpbridge）：
//
//   - stdio（默认）：给 Claude Desktop 等本地客户端用，客户端自动拉起本进程
//   - Streamable HTTP：设置 MCP_ADDR 后监听 HTTP，给远程客户端用，
//     用 MCP_TOKEN 做静态令牌鉴权（不设置 MCP_TOKEN 拒绝启动，避免裸奔）
//
// 配置（环境变量）：
//
//	WORKBENCH_URL  工作台地址，默认 http://127.0.0.1:8080
//	WORKBENCH_USER 账号，默认 admin
//	WORKBENCH_PASS 密码（必填）
//	MCP_ADDR       HTTP 监听地址（如 :8081），留空=stdio 模式
//	MCP_TOKEN      HTTP 模式的鉴权令牌（Authorization: Bearer <token>）
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"personal-workbench/internal/mcpbridge"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	user := env("WORKBENCH_USER", "admin")
	pass := os.Getenv("WORKBENCH_PASS")
	addr := os.Getenv("MCP_ADDR")
	token := os.Getenv("MCP_TOKEN")
	if pass == "" {
		fmt.Fprintln(os.Stderr, "mcp: 未设置 WORKBENCH_PASS（工作台登录密码），无法鉴权")
		os.Exit(2)
	}
	if addr != "" && token == "" {
		fmt.Fprintln(os.Stderr, "mcp: HTTP 模式必须设置 MCP_TOKEN，否则接口会裸奔在公网")
		os.Exit(2)
	}

	ctx := context.Background()
	base := env("WORKBENCH_URL", "http://127.0.0.1:8080")
	wb := mcpbridge.NewClient(base, user, pass)

	server := mcp.NewServer(&mcp.Implementation{Name: "personal-workbench", Version: "0.1.0"}, nil)
	mcpbridge.RegisterTools(server, wb)

	if addr == "" {
		runStdio(ctx, server, wb, base, user)
		return
	}
	runHTTP(ctx, server, wb, addr, token)
}

// runStdio 启动时先试登录，失败了不退出（工作台可能还没起），等第一次工具调用再重试
func runStdio(ctx context.Context, server *mcp.Server, wb *mcpbridge.Client, base, user string) {
	if err := wb.Login(ctx); err != nil {
		log.Printf("mcp: 启动登录失败（首次调用工具时会重试）: %v", err)
	} else {
		log.Printf("mcp: 已登录 %s（账号 %s）", base, user)
	}
	if err := server.Run(ctx, &mcp.StdioTransport{}); err != nil {
		log.Fatalf("mcp: %v", err)
	}
}

// runHTTP 挂鉴权中间件后交给 SDK 的 Streamable HTTP handler
func runHTTP(ctx context.Context, server *mcp.Server, wb *mcpbridge.Client, addr, token string) {
	handler := http.NewServeMux()
	mux := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	handler.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		mux.ServeHTTP(w, r)
	})
	// HTTP 模式不在启动时阻塞登录（服务要常驻，工作台晚起没关系），后台先试一次
	go func() {
		if err := wb.Login(ctx); err != nil {
			log.Printf("mcp: 启动登录失败（首次调用工具时会重试）: %v", err)
		}
	}()
	log.Printf("mcp: HTTP MCP 就绪，监听 %s/mcp", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("mcp: %v", err)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

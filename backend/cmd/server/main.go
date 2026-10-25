package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"personal-workbench/internal/auth"
	"personal-workbench/internal/config"
	"personal-workbench/internal/database"
	"personal-workbench/internal/handler"
	"personal-workbench/internal/mcpbridge"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	cfg := config.Load()

	// JWT 密钥：未配置时自动生成并持久化，避免重启后全员登出
	if cfg.JWTSecret == "" {
		dataDir := filepath.Dir(cfg.DBPath)
		secretFile := filepath.Join(dataDir, ".jwt_secret")
		if b, err := os.ReadFile(secretFile); err == nil && len(b) >= 32 {
			cfg.JWTSecret = string(b)
		} else {
			buf := make([]byte, 32)
			if _, err := rand.Read(buf); err != nil {
				log.Fatalf("generate jwt secret: %v", err)
			}
			cfg.JWTSecret = hex.EncodeToString(buf)
			if dataDir != "" && dataDir != "." {
				_ = os.MkdirAll(dataDir, 0o755)
			}
			if err := os.WriteFile(secretFile, []byte(cfg.JWTSecret), 0o600); err != nil {
				log.Printf("警告: JWT 密钥无法持久化(%v)，本次运行有效，重启后需重新登录", err)
			} else {
				log.Printf("已自动生成 JWT 密钥并保存到 %s", secretFile)
			}
		}
	}

	db, err := database.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}

	created, err := handler.EnsureAdmin(db, cfg.AdminUser, cfg.AdminPass)
	if err != nil {
		log.Fatalf("init admin: %v", err)
	}
	if created {
		log.Printf("已创建初始账号: %s / %s （请尽快修改密码）", cfg.AdminUser, cfg.AdminPass)
	}

	mgr := auth.New(cfg.JWTSecret, cfg.TokenTTL)
	limiter := auth.NewLimiter(5, 10*time.Minute)
	h := handler.New(db, cfg)

	// 上传目录提前建好，免得第一次传图才报错
	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		log.Fatalf("create upload dir %s: %v", cfg.UploadDir, err)
	}
	ah := &handler.AuthHandler{Handler: h, Mgr: mgr, Limiter: limiter, AdminUser: cfg.AdminUser, AdminPass: cfg.AdminPass}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// CORS：开发环境前端 5173 独立访问
	corsCfg := cors.DefaultConfig()
	if cfg.CORSOrigin == "*" {
		corsCfg.AllowAllOrigins = true
	} else {
		corsCfg.AllowOrigins = []string{cfg.CORSOrigin}
	}
	corsCfg.AllowHeaders = []string{"Origin", "Content-Type", "Authorization"}
	corsCfg.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	r.Use(cors.New(corsCfg))

	// 健康检查
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "time": time.Now()})
	})

	api := r.Group("/api")
	{
		api.POST("/auth/login", ah.Login)

		// 图片读取必须放在鉴权组外面：<img src> 是浏览器自己发起的请求，
		// 带不上 Authorization 头，放进 authed 组会一律 401。
		// 安全性靠哈希本身——它是 256 位内容哈希，猜不出来，
		// 等同于一条不可枚举的直达链接（和对象存储的预签名 URL 一个道理）。
		api.GET("/attachments/:hash/raw", h.ServeAttachment)

		authed := api.Group("")
		authed.Use(mgr.Middleware())
		{
			authed.GET("/auth/me", ah.Me)
			authed.POST("/auth/password", ah.ChangePassword)

			authed.GET("/dashboard", h.Dashboard)
			authed.GET("/search", h.Search)

			authed.GET("/projects", h.ListProjects)
			authed.POST("/projects", h.CreateProject)
			authed.GET("/projects/:id", h.GetProject)
			authed.PUT("/projects/:id", h.UpdateProject)
			authed.DELETE("/projects/:id", h.DeleteProject)

			authed.GET("/clients", h.ListClients)
			authed.POST("/clients", h.CreateClient)
			authed.PUT("/clients/:id", h.UpdateClient)
			authed.DELETE("/clients/:id", h.DeleteClient)

			authed.GET("/payments", h.ListPayments)
			authed.POST("/payments", h.CreatePayment)
			authed.PUT("/payments/:id", h.UpdatePayment)
			authed.DELETE("/payments/:id", h.DeletePayment)

			authed.GET("/settings", h.GetSettings)
			authed.PUT("/settings", h.UpdateSettings)

			authed.GET("/tasks", h.ListTasks)
			authed.POST("/tasks", h.CreateTask)
			authed.PUT("/tasks/:id", h.UpdateTask)
			authed.DELETE("/tasks/:id", h.DeleteTask)

			// 子任务（任务内的步骤清单）
			authed.GET("/tasks/:id/subtasks", h.ListSubtasks)
			authed.POST("/tasks/:id/subtasks", h.CreateSubtask)
			authed.POST("/tasks/:id/subtasks/bulk", h.BulkCreateSubtasks)
			authed.PUT("/subtasks/:id", h.UpdateSubtask)
			authed.DELETE("/subtasks/:id", h.DeleteSubtask)

			// 图片附件：文件存磁盘，库里只存哈希和元数据
			authed.POST("/attachments", h.UploadAttachment)
			authed.GET("/attachments", h.ListAttachments)
			authed.DELETE("/attachments/:id", h.DeleteAttachment)

			authed.GET("/reminders", h.ListReminders)
			authed.POST("/reminders", h.CreateReminder)
			authed.PUT("/reminders/:id", h.UpdateReminder)
			authed.DELETE("/reminders/:id", h.DeleteReminder)

			authed.GET("/milestones", h.ListMilestones)
			authed.POST("/milestones", h.CreateMilestone)
			authed.PUT("/milestones/:id", h.UpdateMilestone)
			authed.PATCH("/milestones/:id/status", h.QuickMilestoneStatus)
			authed.DELETE("/milestones/:id", h.DeleteMilestone)

			authed.GET("/tags", h.ListTags)
			authed.POST("/tags", h.CreateTag)
			authed.DELETE("/tags/:id", h.DeleteTag)

			// 灵感记录（收件箱：先存下来，再慢慢消化）
			authed.GET("/ideas", h.ListIdeas)
			authed.GET("/ideas/stats", h.IdeaStats)
			authed.POST("/ideas", h.CreateIdea)
			authed.PUT("/ideas/:id", h.UpdateIdea)
			authed.PATCH("/ideas/:id/status", h.QuickIdeaStatus)
			authed.DELETE("/ideas/:id", h.DeleteIdea)

			// 备份与迁移：导出 = 数据库快照 + 全部图片打成一个 zip；
			// 导入 = 用备份包整库覆盖（换服务器迁移用，见 handler/backup.go）
			authed.GET("/backup/export", h.ExportBackup)
			authed.POST("/backup/import", h.ImportBackup)

			// MCP 连接设置（设置页展示/重置令牌）
			authed.GET("/settings/mcp", h.GetMcpSetting)
			authed.PUT("/settings/mcp", h.UpdateMcpSetting)
		}
	}

	// MCP（Streamable HTTP）：AI 客户端连 https://<域名>/mcp，请求带
	// Authorization: Bearer <令牌>。令牌在设置页生成（存设置表），MCP_TOKEN 环境变量兜底；
	// 两者都没有时端点返回 401，等效关闭。
	wb := mcpbridge.NewClient("http://127.0.0.1"+selfPort(cfg.Addr), cfg.AdminUser, cfg.AdminPass)
	server := mcp.NewServer(&mcp.Implementation{Name: "personal-workbench", Version: "0.1.0"}, nil)
	mcpbridge.RegisterTools(server, wb)
	mux := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	r.Any("/mcp", func(c *gin.Context) {
		tok := h.McpToken()
		if tok == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "MCP 未启用：请先在工作台设置页生成令牌"})
			return
		}
		// 常量时间比对，避免令牌的时序侧信道
		if subtle.ConstantTimeCompare([]byte(c.GetHeader("Authorization")), []byte("Bearer "+tok)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		mux.ServeHTTP(c.Writer, c.Request)
	})

	// 生产环境由后端托管前端静态资源（Docker 单容器部署）
	if staticDir := os.Getenv("STATIC_DIR"); staticDir != "" {
		r.Static("/assets", filepath.Join(staticDir, "assets"))
		r.NoRoute(func(c *gin.Context) {
			c.File(filepath.Join(staticDir, "index.html"))
		})
	}

	srv := &http.Server{Addr: cfg.Addr, Handler: r, ReadHeaderTimeout: 10 * time.Second}

	go func() {
		log.Printf("服务启动: http://localhost%s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务...")

	// 先停止接收新请求，让进行中的请求完成
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP 关闭超时: %v", err)
	}

	// 关闭数据库：触发 WAL checkpoint，保证数据全部落回主库文件
	if err := database.Close(db); err != nil {
		log.Printf("数据库关闭异常: %v", err)
	} else {
		log.Println("数据库已关闭，WAL 已合并")
	}
	log.Println("服务已退出")
}

// selfPort 把监听地址转成 loopback 自访地址：":8080" / "0.0.0.0:8080" → ":8080"。
// MCP 工具在同进程内走 loopback 调 API，用这个拼出 http://127.0.0.1:port。
func selfPort(addr string) string {
	if _, port, err := net.SplitHostPort(addr); err == nil {
		return ":" + port
	}
	return addr
}

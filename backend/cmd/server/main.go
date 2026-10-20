package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
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

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
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
	h := handler.New(db)
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

			authed.GET("/tasks", h.ListTasks)
			authed.POST("/tasks", h.CreateTask)
			authed.PUT("/tasks/:id", h.UpdateTask)
			authed.DELETE("/tasks/:id", h.DeleteTask)

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
		}
	}

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
}

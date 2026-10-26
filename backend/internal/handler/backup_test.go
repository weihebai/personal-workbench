package handler

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"personal-workbench/internal/config"
	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 备份测试需要全部业务表 + 独立的 DBPath（导入时要开第二条连接挂库）
func newBackupTestHandler(t *testing.T) *Handler {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "workbench.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	// 同 attachment_test.go：必须关掉连接，否则 Windows 上 TempDir 清理会报文件占用
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(model.AllModels()...); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}
	uploadDir := filepath.Join(dir, "uploads")
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		t.Fatalf("建上传目录失败: %v", err)
	}
	return &Handler{
		DB: db,
		Cfg: &config.Config{
			UploadDir:            uploadDir,
			MaxUploadBytes:       10 << 20,
			MaxBackupUploadBytes: 64 << 20,
			DBPath:               dbPath,
		},
	}
}

// 给一张表所有模型都塞一行种子数据，返回主项目 ID
func seedBackupData(t *testing.T, h *Handler) (projectID uint, attachmentHash string) {
	t.Helper()
	u := model.User{Username: "admin", PasswordHash: "hash-abc", Nickname: "管理员"}
	if err := h.DB.Create(&u).Error; err != nil {
		t.Fatalf("造用户失败: %v", err)
	}
	cl := model.Client{Name: "测试客户", Phone: "13800000000", Source: "闲鱼"}
	if err := h.DB.Create(&cl).Error; err != nil {
		t.Fatalf("造客户失败: %v", err)
	}
	p := model.Project{Name: "测试项目", Kind: "outsource", Status: "active", ClientID: &cl.ID, Quote: 1000.5}
	if err := h.DB.Create(&p).Error; err != nil {
		t.Fatalf("造项目失败: %v", err)
	}
	pay := model.Payment{ProjectID: p.ID, Title: "首款", Amount: 500, Status: "received"}
	tk := model.Task{Title: "测试任务", ProjectID: &p.ID, Status: "todo"}
	rm := model.Reminder{Title: "域名续费", Category: "domain", ExpireAt: time.Now().Add(30 * 24 * time.Hour), Enabled: true}
	ms := model.Milestone{ProjectID: p.ID, Title: "备案审核", Status: "waiting", Days: 7}
	idea := model.Idea{Title: "好文章", URL: "https://example.com", Status: "inbox"}
	deadIdea := model.Idea{Title: "已删灵感", Status: "archived"}
	tag1 := model.Tag{Name: "前端", Color: "#ff0000"}
	tag2 := model.Tag{Name: "副业"}
	se := model.Setting{Key: "theme", Value: "dark"}
	for _, m := range []any{&pay, &tk, &rm, &ms, &idea, &deadIdea, &tag1, &tag2, &se} {
		if err := h.DB.Create(m).Error; err != nil {
			t.Fatalf("造种子数据失败(%T): %v", m, err)
		}
	}
	st := model.Subtask{TaskID: tk.ID, Title: "步骤一", Done: true, Sort: 0}
	tg := model.Taggable{TagID: tag1.ID, TargetID: p.ID, Target: "project"}
	for _, m := range []any{&st, &tg} {
		if err := h.DB.Create(m).Error; err != nil {
			t.Fatalf("造种子数据失败(%T): %v", m, err)
		}
	}
	// 软删一条：备份必须把它连同 DeletedAt 一起带走
	if err := h.DB.Delete(&deadIdea).Error; err != nil {
		t.Fatalf("软删失败: %v", err)
	}
	hash, _ := writeFakeImage(t, h, "backup-image-bytes")
	att := model.Attachment{
		Hash: hash, Name: "img.png", Mime: "image/png",
		Size: int64(len("backup-image-bytes")), TaskID: &tk.ID,
	}
	if err := h.DB.Create(&att).Error; err != nil {
		t.Fatalf("造附件失败: %v", err)
	}
	return p.ID, hash
}

func doExport(t *testing.T, h *Handler) []byte {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/backup/export", nil)
	h.ExportBackup(c)
	if w.Code != http.StatusOK {
		t.Fatalf("导出失败: %d %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("Content-Type 应为 application/zip，实际 %s", ct)
	}
	return w.Body.Bytes()
}

func doImport(t *testing.T, h *Handler, zipBytes []byte) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	fw, err := mw.CreateFormFile("file", "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(zipBytes); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/backup/import", body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	h.ImportBackup(c)
	return w
}

func makeZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// 核心场景：导出 → 换一个全新环境导入，数据应当原样回来
func TestBackupRoundTrip(t *testing.T) {
	h1 := newBackupTestHandler(t)
	projectID, imgHash := seedBackupData(t, h1)

	zipBytes := doExport(t, h1)

	h2 := newBackupTestHandler(t)
	w := doImport(t, h2, zipBytes)
	if w.Code != http.StatusOK {
		t.Fatalf("导入失败: %d %s", w.Code, w.Body.String())
	}

	// 用户连密码哈希一起回来（json:"-" 的字段不能丢）
	var u model.User
	if err := h2.DB.First(&u).Error; err != nil {
		t.Fatalf("用户应被恢复: %v", err)
	}
	if u.PasswordHash != "hash-abc" {
		t.Fatalf("密码哈希应原样保留，实际 %s", u.PasswordHash)
	}

	// 各表行数与关键 ID
	var n int64
	for _, tc := range []struct {
		name  string
		model any
		want  int64
	}{
		{"users", &model.User{}, 1},
		{"clients", &model.Client{}, 1},
		{"projects", &model.Project{}, 1},
		{"payments", &model.Payment{}, 1},
		{"tasks", &model.Task{}, 1},
		{"subtasks", &model.Subtask{}, 1},
		{"reminders", &model.Reminder{}, 1},
		{"milestones", &model.Milestone{}, 1},
		{"tags", &model.Tag{}, 2},
		{"taggables", &model.Taggable{}, 1},
		{"settings", &model.Setting{}, 1},
		{"attachments", &model.Attachment{}, 1},
	} {
		h2.DB.Unscoped().Model(tc.model).Count(&n)
		if n != tc.want {
			t.Fatalf("%s 应恢复 %d 行，实际 %d", tc.name, tc.want, n)
		}
	}
	// 灵感有两条，其中一条带着软删标记回来
	h2.DB.Unscoped().Model(&model.Idea{}).Count(&n)
	if n != 2 {
		t.Fatalf("ideas（含软删）应恢复 2 行，实际 %d", n)
	}

	var p model.Project
	if err := h2.DB.First(&p, projectID).Error; err != nil {
		t.Fatalf("项目 ID 应原样保留: %v", err)
	}
	if p.Quote != 1000.5 {
		t.Fatalf("浮点字段应原样保留，实际 %v", p.Quote)
	}

	// 软删记录仍是软删态
	var alive model.Idea
	if err := h2.DB.Where("title = ?", "已删灵感").First(&alive).Error; err == nil {
		t.Fatal("软删记录不应出现在正常查询里")
	}
	var deleted model.Idea
	if err := h2.DB.Unscoped().Where("title = ?", "已删灵感").First(&deleted).Error; err != nil {
		t.Fatalf("软删记录应带着 DeletedAt 恢复: %v", err)
	}
	if deleted.DeletedAt.Time.IsZero() {
		t.Fatal("DeletedAt 不应为空值")
	}

	// 图片文件跟着回来，字节一致
	got, err := os.ReadFile(h2.filePathFor(imgHash, ".png"))
	if err != nil {
		t.Fatalf("图片文件应被恢复: %v", err)
	}
	if string(got) != "backup-image-bytes" {
		t.Fatalf("图片内容应一致，实际 %q", string(got))
	}

	// 自增 ID 从备份的最大值继续，而不是从 1 重来
	np := model.Project{Name: "导入后新建"}
	if err := h2.DB.Create(&np).Error; err != nil {
		t.Fatalf("导入后建项目失败: %v", err)
	}
	if np.ID != projectID+1 {
		t.Fatalf("新项目 ID 应为 %d，实际 %d", projectID+1, np.ID)
	}
}

// 二次导出再导入：以备份包为源再迁一次也应无损（幂等性抽查）
func TestBackupRoundTripTwice(t *testing.T) {
	h1 := newBackupTestHandler(t)
	seedBackupData(t, h1)

	h2 := newBackupTestHandler(t)
	if w := doImport(t, h2, doExport(t, h1)); w.Code != http.StatusOK {
		t.Fatalf("第一次导入失败: %d %s", w.Code, w.Body.String())
	}

	h3 := newBackupTestHandler(t)
	if w := doImport(t, h3, doExport(t, h2)); w.Code != http.StatusOK {
		t.Fatalf("第二次导入失败: %d %s", w.Code, w.Body.String())
	}

	var n1, n3 int64
	h2.DB.Unscoped().Model(&model.Task{}).Count(&n1)
	h3.DB.Unscoped().Model(&model.Task{}).Count(&n3)
	if n1 != n3 {
		t.Fatalf("二次迁移后任务数应一致，%d != %d", n1, n3)
	}
}

// 导入是覆盖式的：目标库里已有的数据会被备份包的内容替换掉
func TestImportReplacesExistingData(t *testing.T) {
	h1 := newBackupTestHandler(t)
	seedBackupData(t, h1)
	zipBytes := doExport(t, h1)

	h2 := newBackupTestHandler(t)
	old := model.Project{Name: "旧服务器上的项目"}
	h2.DB.Create(&old)

	if w := doImport(t, h2, zipBytes); w.Code != http.StatusOK {
		t.Fatalf("导入失败: %d %s", w.Code, w.Body.String())
	}

	var n int64
	h2.DB.Model(&model.Project{}).Count(&n)
	if n != 1 {
		t.Fatalf("导入后应只剩备份里的 1 个项目，实际 %d", n)
	}
	var count int64
	h2.DB.Model(&model.Project{}).Where("name = ?", "旧服务器上的项目").Count(&count)
	if count != 0 {
		t.Fatal("旧数据应被清掉")
	}
}

func TestImportRejectsBadInputs(t *testing.T) {
	validManifest := `{"version":1,"app":"personal-workbench","exportedAt":"2026-01-01T00:00:00Z","db":{"bytes":0},"uploads":{"files":0,"bytes":0}}`

	t.Run("manifest 版本过新", func(t *testing.T) {
		h := newBackupTestHandler(t)
		newer := strings.Replace(validManifest, `"version":1`, `"version":99`, 1)
		w := doImport(t, h, makeZip(t, map[string]string{
			"manifest.json": newer,
			"workbench.db":  "garbage",
		}))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝过新的备份包，实际 %d", w.Code)
		}
	})

	t.Run("不是本应用的备份", func(t *testing.T) {
		h := newBackupTestHandler(t)
		alien := strings.Replace(validManifest, `"app":"personal-workbench"`, `"app":"other"`, 1)
		w := doImport(t, h, makeZip(t, map[string]string{
			"manifest.json": alien,
			"workbench.db":  "garbage",
		}))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝其他应用的备份包，实际 %d", w.Code)
		}
	})

	t.Run("数据库损坏", func(t *testing.T) {
		h := newBackupTestHandler(t)
		w := doImport(t, h, makeZip(t, map[string]string{
			"manifest.json": validManifest,
			"workbench.db":  "this is not a sqlite database file",
		}))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝损坏的备份库，实际 %d %s", w.Code, w.Body.String())
		}
	})

	t.Run("缺少清单或数据库", func(t *testing.T) {
		h := newBackupTestHandler(t)
		w := doImport(t, h, makeZip(t, map[string]string{"workbench.db": "x"}))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝缺 manifest 的包，实际 %d", w.Code)
		}
		w = doImport(t, h, makeZip(t, map[string]string{"manifest.json": validManifest}))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝缺 db 的包，实际 %d", w.Code)
		}
	})

	t.Run("zip-slip 路径", func(t *testing.T) {
		h := newBackupTestHandler(t)
		w := doImport(t, h, makeZip(t, map[string]string{
			"manifest.json":       validManifest,
			"workbench.db":        "x",
			"uploads/../evil.txt": "boom",
		}))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝路径穿越的包，实际 %d", w.Code)
		}
	})

	t.Run("无法识别的文件", func(t *testing.T) {
		h := newBackupTestHandler(t)
		w := doImport(t, h, makeZip(t, map[string]string{
			"manifest.json": validManifest,
			"workbench.db":  "x",
			"extra.txt":     "?",
		}))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝含未知文件的包，实际 %d", w.Code)
		}
	})

	t.Run("不是 zip", func(t *testing.T) {
		h := newBackupTestHandler(t)
		w := doImport(t, h, []byte("plain text, not a zip"))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("应拒绝非 zip 文件，实际 %d", w.Code)
		}
	})
}

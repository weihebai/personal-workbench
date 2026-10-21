package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"personal-workbench/internal/config"
	"personal-workbench/internal/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 建一个用完即删的内存库 + 临时上传目录
func newTestHandler(t *testing.T) (*Handler, string) {
	t.Helper()
	dir := t.TempDir()

	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	// 测试结束必须关掉底层连接，否则 Windows 上 t.TempDir 的清理会报
	// 「文件正被另一个进程使用」，把通过的测试也算成失败。
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(&model.Task{}, &model.Subtask{}, &model.Attachment{}, &model.Project{}); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	uploadDir := filepath.Join(dir, "uploads")
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		t.Fatalf("建上传目录失败: %v", err)
	}
	return &Handler{DB: db, Cfg: &config.Config{UploadDir: uploadDir, MaxUploadBytes: 10 << 20}}, uploadDir
}

// 写一个假的图片文件，返回它的哈希
func writeFakeImage(t *testing.T, h *Handler, content string) (string, string) {
	t.Helper()
	sum := sha256.Sum256([]byte(content))
	hash := hex.EncodeToString(sum[:])
	path := h.filePathFor(hash, ".png")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("建目录失败: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("写文件失败: %v", err)
	}
	return hash, path
}

// 核心回归：一张图可以同时挂在两个任务上。
//
// 之前 hash 上有 uniqueIndex，第二条记录插不进去，代码只能去「改」第一条，
// 结果 B 任务上传同一张图，A 任务的图就凭空消失了。
func TestAttachmentSharedAcrossTasks(t *testing.T) {
	h, _ := newTestHandler(t)

	hash, _ := writeFakeImage(t, h, "same-image-bytes")

	taskA, taskB := uint(1), uint(2)
	a := model.Attachment{Hash: hash, Name: "a.png", Mime: "image/png", TaskID: &taskA}
	b := model.Attachment{Hash: hash, Name: "b.png", Mime: "image/png", TaskID: &taskB}

	if err := h.DB.Create(&a).Error; err != nil {
		t.Fatalf("第一条记录应能插入: %v", err)
	}
	if err := h.DB.Create(&b).Error; err != nil {
		t.Fatalf("同 hash 的第二条记录也应该能插入（非唯一索引）: %v", err)
	}

	var countA, countB int64
	h.DB.Model(&model.Attachment{}).Where("task_id = ?", taskA).Count(&countA)
	h.DB.Model(&model.Attachment{}).Where("task_id = ?", taskB).Count(&countB)
	if countA != 1 || countB != 1 {
		t.Fatalf("两个任务各自应各有 1 张图，实际 A=%d B=%d", countA, countB)
	}
}

// 删记录时：还有别人引用就不删文件，没人引用了才删
func TestCleanupOrphanFile(t *testing.T) {
	h, _ := newTestHandler(t)

	hash, path := writeFakeImage(t, h, "shared")

	// 两个任务共用同一个物理文件
	taskA, taskB := uint(1), uint(2)
	a := model.Attachment{Hash: hash, Name: "a.png", Mime: "image/png", TaskID: &taskA}
	b := model.Attachment{Hash: hash, Name: "b.png", Mime: "image/png", TaskID: &taskB}
	h.DB.Create(&a)
	h.DB.Create(&b)

	// 删掉 A 的记录：B 还在用，文件不能删
	h.DB.Delete(&model.Attachment{}, a.ID)
	if removed := h.cleanupOrphanFile(hash, "image/png"); removed {
		t.Fatal("还有记录引用时不该删文件")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("文件不该被删掉")
	}

	// 删掉 B 的记录：没人引用了，文件该删
	h.DB.Delete(&model.Attachment{}, b.ID)
	if removed := h.cleanupOrphanFile(hash, "image/png"); !removed {
		t.Fatal("没有记录引用时应该删掉文件")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("文件应该已被删除")
	}
}

// 删任务要连带把它的图片记录和文件都收干净
func TestDropAttachmentsByTask(t *testing.T) {
	h, _ := newTestHandler(t)

	hash, path := writeFakeImage(t, h, "task-only")
	taskID := uint(7)
	h.DB.Create(&model.Attachment{Hash: hash, Name: "x.png", Mime: "image/png", TaskID: &taskID})

	h.dropAttachmentsBy("task_id", taskID)

	var n int64
	h.DB.Model(&model.Attachment{}).Where("task_id = ?", taskID).Count(&n)
	if n != 0 {
		t.Fatalf("记录应被删除，还剩 %d 条", n)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("磁盘文件应被一并删除")
	}
}

// 文件已经不在磁盘上时，清理不应该报错（比如手工删过 data 目录）
func TestCleanupMissingFile(t *testing.T) {
	h, _ := newTestHandler(t)
	hash, path := writeFakeImage(t, h, "will-vanish")
	os.Remove(path)

	if removed := h.cleanupOrphanFile(hash, "image/png"); removed {
		t.Fatal("文件本来就不在，不该返回「已删除」")
	}
}

// filePathFor 的分级目录规则：前两位做子目录
func TestFilePathFor(t *testing.T) {
	h, uploadDir := newTestHandler(t)
	hash := "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	got := h.filePathFor(hash, ".png")
	want := filepath.Join(uploadDir, "ab", hash+".png")
	if got != want {
		t.Fatalf("路径不对:\n got  %s\n want %s", got, want)
	}
}

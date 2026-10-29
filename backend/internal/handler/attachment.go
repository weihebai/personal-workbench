package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"personal-workbench/internal/model"
	"personal-workbench/internal/storage"

	"github.com/gin-gonic/gin"
)

// 图片上传。未配置 R2 时落本地 data/uploads，配置后新图直接写入 R2。

// 只接受这几种图片，别的一律拒绝
var allowedImageMime = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

func (h *Handler) r2Client() (*storage.R2, error) {
	if h.settingValue(r2ConfiguredKey) != "1" {
		return nil, nil
	}
	secret, err := h.decryptSecret(h.settingValue(r2CredentialValueKey))
	if err != nil {
		return nil, err
	}
	return storage.NewR2(storage.R2Config{
		AccountID:       h.settingValue(r2AccountKey),
		Bucket:          h.settingValue(r2BucketKey),
		AccessKeyID:     h.settingValue(r2CredentialIDKey),
		SecretAccessKey: secret,
		Jurisdiction:    h.settingValue(r2JurisdictionKey),
	})
}

// POST /api/attachments   multipart/form-data: file, taskId?, projectId?
func (h *Handler) UploadAttachment(c *gin.Context) {
	if h.Cfg.MaxUploadBytes > 0 {
		// 溢出保护，防止超大文件把内存吃光
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.Cfg.MaxUploadBytes+1024*1024)
	}

	fh, err := c.FormFile("file")
	if err != nil {
		badRequest(c, "没有收到文件")
		return
	}
	if h.Cfg.MaxUploadBytes > 0 && fh.Size > h.Cfg.MaxUploadBytes {
		badRequest(c, "图片太大，上限 "+humanSize(h.Cfg.MaxUploadBytes))
		return
	}

	src, err := fh.Open()
	if err != nil {
		serverErr(c, err)
		return
	}
	defer src.Close()

	// 先落到临时文件算哈希，避免整张图读进内存
	tmp, err := os.CreateTemp("", "upload-*")
	if err != nil {
		serverErr(c, err)
		return
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, hash), src)
	if err != nil {
		tmp.Close()
		serverErr(c, err)
		return
	}
	// 真伪校验：只信文件头解出来的格式，不信客户端声明的 Content-Type
	// （否则改个后缀就能上传任意内容）
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		tmp.Close()
		serverErr(c, err)
		return
	}
	cfg, format, err := image.DecodeConfig(tmp)
	tmp.Close()
	if err != nil {
		badRequest(c, "这个文件不是有效的图片")
		return
	}
	ext, ok := map[string]string{"jpeg": ".jpg", "png": ".png", "gif": ".gif", "webp": ".webp"}[format]
	if !ok {
		badRequest(c, "只支持 jpg / png / gif / webp 格式")
		return
	}
	mime := ""
	for m, e := range allowedImageMime {
		if e == ext {
			mime = m
			break
		}
	}

	sum := hex.EncodeToString(hash.Sum(nil))
	r2, r2Err := h.r2Client()
	if r2Err != nil {
		serverErr(c, r2Err)
		return
	}
	storageKind := "local"
	if r2 != nil {
		storageKind = "r2"
	}

	// 归属关系：任务 / 项目 / 内容三选一，多传直接拒绝，
	// 否则一张图到底属于谁就说不清了。
	var taskID, projectID, contentID *uint
	if tid := c.PostForm("taskId"); tid != "" {
		if id, e := parseUint(tid); e == nil {
			taskID = &id
		}
	}
	if pid := c.PostForm("projectId"); pid != "" {
		if id, e := parseUint(pid); e == nil {
			projectID = &id
		}
	}
	if cid := c.PostForm("contentId"); cid != "" {
		if id, e := parseUint(cid); e == nil {
			contentID = &id
		}
	}
	owners := 0
	if taskID != nil {
		owners++
	}
	if projectID != nil {
		owners++
	}
	if contentID != nil {
		owners++
	}
	if owners > 1 {
		badRequest(c, "图片只能归属任务、项目或内容中的一处")
		return
	}
	if contentID != nil {
		var n int64
		h.DB.Model(&model.Content{}).Where("id = ?", *contentID).Count(&n)
		if n == 0 {
			badRequest(c, "内容不存在")
			return
		}
	}

	// 同一张图挂到同一个任务/项目/内容上：直接返回已有记录，避免重复粘贴产生两条一样的
	var dup model.Attachment
	dupQ := h.DB.Where("hash = ? AND storage = ?", sum, storageKind)
	if taskID != nil {
		dupQ = dupQ.Where("task_id = ?", *taskID)
	} else if projectID != nil {
		dupQ = dupQ.Where("project_id = ? AND task_id IS NULL", *projectID)
	} else if contentID != nil {
		dupQ = dupQ.Where("content_id = ? AND task_id IS NULL AND project_id IS NULL", *contentID)
	} else {
		dupQ = dupQ.Where("task_id IS NULL AND project_id IS NULL AND content_id IS NULL")
	}
	if err := dupQ.First(&dup).Error; err == nil {
		dup.URL = "/api/attachments/" + dup.Hash + "/raw"
		c.JSON(http.StatusOK, dup)
		return
	}

	if r2 != nil {
		f, openErr := os.Open(tmpPath)
		if openErr != nil {
			serverErr(c, openErr)
			return
		}
		defer f.Close()
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()
		if err := r2.Put(ctx, h.objectKey(sum, ext), f, size, mime); err != nil {
			serverErr(c, err)
			return
		}
	} else {
		// 文件已存在就不重复写（内容寻址，同名即同内容）
		dst := h.filePathFor(sum, ext)
		if _, statErr := os.Stat(dst); statErr != nil {
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				serverErr(c, err)
				return
			}
			if err := os.Rename(tmpPath, dst); err != nil {
				// 跨盘时 Rename 会失败，退化成复制
				if err := copyFile(tmpPath, dst); err != nil {
					serverErr(c, err)
					return
				}
			}
		}
	}

	att := model.Attachment{
		Hash:      sum,
		Storage:   storageKind,
		Name:      truncate(fh.Filename, 255),
		Mime:      mime,
		Size:      size,
		Width:     cfg.Width,
		Height:    cfg.Height,
		TaskID:    taskID,
		ProjectID: projectID,
		ContentID: contentID,
	}
	if err := h.DB.Create(&att).Error; err != nil {
		serverErr(c, err)
		return
	}
	att.URL = "/api/attachments/" + att.Hash + "/raw"
	c.JSON(http.StatusOK, att)
}

// 磁盘路径：data/uploads/ab/abcdef....jpg（分两级，避免单目录堆几万个文件）
func (h *Handler) filePathFor(hash, ext string) string {
	return filepath.Join(h.Cfg.UploadDir, hash[:2], hash+ext)
}

func (h *Handler) objectKey(hash, ext string) string {
	return "uploads/" + hash[:2] + "/" + hash + ext
}

// GET /api/attachments/raw/:hash   -> 返回图片字节
func (h *Handler) ServeAttachment(c *gin.Context) {
	hash := c.Param("hash")
	if len(hash) != 64 {
		notFound(c, "文件不存在")
		return
	}
	var att model.Attachment
	// 同一个 hash 可能同时存在本地旧记录和后来上传到 R2 的记录；
	// 优先返回 R2，避免 R2 文件仍可用时误以为图片已丢失。
	if err := h.DB.Where("hash = ? AND storage = ?", hash, "r2").First(&att).Error; err != nil {
		if err := h.DB.Where("hash = ?", hash).First(&att).Error; err != nil {
			notFound(c, "文件不存在")
			return
		}
	}
	if att.Storage == "" {
		att.Storage = "local"
	}
	ext := allowedImageMime[att.Mime]
	if ext == "" {
		ext = ".bin"
	}
	// 内容按哈希命名，永不变化，可以放心长缓存
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Content-Type", att.Mime)
	if att.Storage == "r2" {
		r2, err := h.r2Client()
		if err != nil {
			serverErr(c, err)
			return
		}
		if r2 == nil {
			notFound(c, "R2 未配置")
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()
		body, _, _, err := r2.Get(ctx, h.objectKey(hash, ext))
		if err != nil {
			if storage.IsNotFound(err) {
				notFound(c, "文件已丢失")
				return
			}
			serverErr(c, err)
			return
		}
		defer body.Close()
		if _, err := io.Copy(c.Writer, body); err != nil {
			c.Abort()
		}
		return
	}
	f, err := os.Open(h.filePathFor(hash, ext))
	if err != nil {
		notFound(c, "文件已丢失")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		serverErr(c, err)
		return
	}
	http.ServeContent(c.Writer, c.Request, att.Name, st.ModTime(), f)
}

// GET /api/attachments?taskId=1&projectId=2&contentId=3
func (h *Handler) ListAttachments(c *gin.Context) {
	q := h.DB.Model(&model.Attachment{})
	if id := queryUint(c, "taskId"); id != nil {
		q = q.Where("task_id = ?", *id)
	}
	if id := queryUint(c, "projectId"); id != nil {
		q = q.Where("project_id = ?", *id)
	}
	if id := queryUint(c, "contentId"); id != nil {
		q = q.Where("content_id = ?", *id)
	}
	var items []model.Attachment
	if err := q.Order("id DESC").Limit(200).Find(&items).Error; err != nil {
		serverErr(c, err)
		return
	}
	for i := range items {
		items[i].URL = "/api/attachments/" + items[i].Hash + "/raw"
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

// DELETE /api/attachments/:id
//
// 删记录，并在没有任何其他记录引用同一个 hash 时把磁盘文件也删掉。
// 之前的版本只删记录不删文件，理由是「文件可能被共享」——但当时 hash 上
// 有唯一索引，共享根本不可能发生，那个理由是错的，结果磁盘只涨不减。
func (h *Handler) DeleteAttachment(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var att model.Attachment
	if err := h.DB.First(&att, id).Error; err != nil {
		notFound(c, "图片不存在")
		return
	}
	if err := h.DB.Delete(&model.Attachment{}, id).Error; err != nil {
		serverErr(c, err)
		return
	}
	removed := h.cleanupOrphanFile(att.Hash, att.Mime, att.Storage)
	c.JSON(http.StatusOK, gin.H{"ok": true, "fileRemoved": removed})
}

// 如果这个 hash 已经没有任何记录引用了，就把磁盘文件删掉。
// 返回是否真的删了文件。
func (h *Handler) cleanupOrphanFile(hash, mime, storageKind string) bool {
	var n int64
	h.DB.Model(&model.Attachment{}).Where("hash = ? AND storage = ?", hash, storageKind).Count(&n)
	if n > 0 {
		return false
	}
	ext := allowedImageMime[mime]
	if ext == "" {
		ext = ".bin"
	}
	if storageKind == "r2" {
		r2, err := h.r2Client()
		if err != nil || r2 == nil {
			return false
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := r2.Delete(ctx, h.objectKey(hash, ext)); err != nil {
			return false
		}
		return true
	}
	path := h.filePathFor(hash, ext)
	if err := os.Remove(path); err != nil {
		// 文件本来就不在不算错误；这里只记录，不影响接口结果
		return false
	}
	// 顺手清掉空的二级目录，别留一堆空文件夹
	_ = os.Remove(filepath.Dir(path))
	return true
}

// 批量清理：删任务/删项目时把它们名下的附件一起收干净，
// 否则记录留着一个指向不存在任务的 task_id，文件也永远没人删。
func (h *Handler) dropAttachmentsBy(field string, id uint) {
	var list []model.Attachment
	h.DB.Where(field+" = ?", id).Find(&list)
	if len(list) == 0 {
		return
	}
	h.DB.Where(field+" = ?", id).Delete(&model.Attachment{})
	// 去重后逐个检查，避免同一 hash 被检查多次
	seen := map[string]bool{}
	for _, a := range list {
		if seen[a.Hash] {
			continue
		}
		seen[a.Hash] = true
		h.cleanupOrphanFile(a.Hash, a.Mime, a.Storage)
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return itoa(int(n>>20)) + " MB"
	case n >= 1<<10:
		return itoa(int(n>>10)) + " KB"
	}
	return itoa(int(n)) + " B"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func parseUint(s string) (uint, error) {
	s = strings.TrimSpace(s)
	// 空串必须报错：否则 "" 会被静默当成 0，
	// 前端漏传 id 时会写成 task_id=0 这种脏数据而不是被拒绝。
	if s == "" {
		return 0, os.ErrInvalid
	}
	var v uint
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, os.ErrInvalid
		}
		v = v*10 + uint(ch-'0')
	}
	return v, nil
}

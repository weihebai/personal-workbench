package handler

// 备份与迁移。
//
// 备份包就是一个 zip：SQLite 快照 + uploads/ 图片 + manifest.json。
// - 导出：VACUUM INTO 生成一致性快照（WAL 下在线执行，不用停机），
//   软删记录、密码哈希等全部原样保留，比结构体转 JSON 保真得多
//   （模型上 DeletedAt / PasswordHash 都是 json:"-"，序列化会丢字段）。
// - 导入：独立连接 ATTACH 备份库，单事务内清空业务表再整表拷回，
//   任一步失败即回滚，现有数据不受影响；图片按内容哈希落盘，已存在就跳过。
//
// JWT 密钥不进备份包：换服务器后用备份里的账号重新登录即可，
// 避免把能伪造登录态的密钥随身携带、到处留存。

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
	_ "github.com/glebarez/sqlite" // 注册 sqlite 驱动，供导入时开独立连接使用
	"gorm.io/gorm"
)

const (
	backupFormatVersion = 1
	backupAppName       = "personal-workbench"
	backupDBEntry       = "workbench.db"
	backupManifestEntry = "manifest.json"
	backupUploadsPrefix = "uploads/"
)

type backupManifest struct {
	Version    int    `json:"version"`
	App        string `json:"app"`
	ExportedAt string `json:"exportedAt"`
	DB         struct {
		Bytes int64 `json:"bytes"`
	} `json:"db"`
	Uploads struct {
		Files int   `json:"files"`
		Bytes int64 `json:"bytes"`
	} `json:"uploads"`
}

// 业务表名，从模型定义推导，以后加表自动纳入备份范围。
// 顺序即 model.AllModels() 注册顺序：导入时按此序插回（父表在前），
// 删除时倒序（子表先删）。
func (h *Handler) tableNames() ([]string, error) {
	models := model.AllModels()
	names := make([]string, 0, len(models))
	for _, m := range models {
		stmt := &gorm.Statement{DB: h.DB}
		if err := stmt.Parse(m); err != nil {
			return nil, err
		}
		names = append(names, stmt.Schema.Table)
	}
	return names, nil
}

// GET /api/backup/export
func (h *Handler) ExportBackup(c *gin.Context) {
	// 快照先落到临时文件，再流式打进 zip。
	// VACUUM INTO 的目标路径不能绑定参数，只能内联拼进 SQL——
	// 路径是刚生成的临时目录名，唯一要防的是单引号。
	tmpDir, err := os.MkdirTemp("", "wb-export-*")
	if err != nil {
		serverErr(c, err)
		return
	}
	defer os.RemoveAll(tmpDir)
	dbPath := filepath.Join(tmpDir, backupDBEntry)
	vacuum := "VACUUM INTO '" + strings.ReplaceAll(filepath.ToSlash(dbPath), "'", "''") + "'"
	if err := h.DB.Exec(vacuum).Error; err != nil {
		serverErr(c, fmt.Errorf("生成数据库快照失败: %w", err))
		return
	}
	// R2 凭据与当前机器绑定，不写入备份包。
	if err := stripSettings(dbPath, r2SettingKeys); err != nil {
		serverErr(c, fmt.Errorf("清理备份配置失败: %w", err))
		return
	}
	dbStat, err := os.Stat(dbPath)
	if err != nil {
		serverErr(c, err)
		return
	}

	// 先清点图片：manifest 写在最前面，统计必须先算出来
	type uploadFile struct {
		rel  string
		abs  string
		size int64
	}
	var uploads []uploadFile
	var uploadsBytes int64
	if _, err := os.Stat(h.Cfg.UploadDir); err == nil {
		err = filepath.WalkDir(h.Cfg.UploadDir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(h.Cfg.UploadDir, path)
			if err != nil {
				return err
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			uploads = append(uploads, uploadFile{rel: filepath.ToSlash(rel), abs: path, size: info.Size()})
			uploadsBytes += info.Size()
			return nil
		})
		if err != nil {
			serverErr(c, err)
			return
		}
	} else if !os.IsNotExist(err) {
		serverErr(c, err)
		return
	}
	var remote []model.Attachment
	h.DB.Select("DISTINCT hash, mime, size").Where("storage = ?", "r2").Find(&remote)
	for _, a := range remote {
		ext := allowedImageMime[a.Mime]
		if ext == "" {
			ext = ".bin"
		}
		uploads = append(uploads, uploadFile{
			rel:  a.Hash[:2] + "/" + a.Hash + ext,
			abs:  "r2:" + h.objectKey(a.Hash, ext),
			size: a.Size,
		})
		uploadsBytes += a.Size
	}
	// R2 图片可能被多条记录引用，只导出一次
	seenRel := map[string]bool{}
	deduped := uploads[:0]
	for _, u := range uploads {
		if seenRel[u.rel] {
			continue
		}
		seenRel[u.rel] = true
		deduped = append(deduped, u)
	}
	uploads = deduped
	dedupedBytes := int64(0)
	for _, u := range uploads {
		dedupedBytes += u.size
	}
	uploadsBytes = dedupedBytes

	var mf backupManifest
	mf.Version = backupFormatVersion
	mf.App = backupAppName
	mf.ExportedAt = time.Now().Format(time.RFC3339)
	mf.DB.Bytes = dbStat.Size()
	mf.Uploads.Files = len(uploads)
	mf.Uploads.Bytes = uploadsBytes
	mfBytes, err := json.Marshal(mf)
	if err != nil {
		serverErr(c, err)
		return
	}

	filename := "workbench-backup-" + time.Now().Format("20060102-1504") + ".zip"
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Status(http.StatusOK)

	zw := zip.NewWriter(c.Writer)
	// 响应头已经发出，中途出错没法再改状态码，只能掐断连接；
	// zip 每个条目带 CRC，客户端解压时会发现文件损坏而不是拿到半截好文件。
	abort := func(err error) {
		_ = zw.Close()
		c.Abort()
		_ = err
	}

	if w, err := zw.Create(backupManifestEntry); err != nil {
		abort(err)
		return
	} else if _, err := w.Write(mfBytes); err != nil {
		abort(err)
		return
	}

	if err := writeZipEntry(zw, backupDBEntry, zip.Deflate, dbPath, dbStat.Size()); err != nil {
		abort(err)
		return
	}
	for _, u := range uploads {
		// 图片本身已是压缩格式，用 Store 免去无谓的压缩耗时
		if err := h.writeUploadEntry(zw, backupUploadsPrefix+u.rel, u.abs, u.size); err != nil {
			abort(err)
			return
		}
	}
	if err := zw.Close(); err != nil {
		c.Abort()
		return
	}
}

func (h *Handler) writeUploadEntry(zw *zip.Writer, name, path string, size int64) error {
	if !strings.HasPrefix(path, "r2:") {
		return writeZipEntry(zw, name, zip.Store, path, size)
	}
	r2, err := h.r2Client()
	if err != nil {
		return err
	}
	if r2 == nil {
		return fmt.Errorf("R2 未配置，无法导出远程图片")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	body, actual, _, err := r2.Get(ctx, strings.TrimPrefix(path, "r2:"))
	if err != nil {
		return fmt.Errorf("读取 R2 图片失败: %w", err)
	}
	defer body.Close()
	if actual > 0 {
		size = actual
	}
	hdr := &zip.FileHeader{Name: name, Method: zip.Store, Modified: time.Now()}
	hdr.SetMode(0o644)
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	n, err := io.Copy(w, body)
	if err != nil {
		return err
	}
	if n != size {
		return fmt.Errorf("%s: 写入 %d 字节，预期 %d", name, n, size)
	}
	return nil
}

func writeZipEntry(zw *zip.Writer, name string, method uint16, path string, size int64) error {
	hdr := &zip.FileHeader{Name: name, Method: method, Modified: time.Now()}
	hdr.SetMode(0o644)
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := io.Copy(w, f)
	if err != nil {
		return err
	}
	if n != size {
		return fmt.Errorf("%s: 写入 %d 字节，预期 %d", name, n, size)
	}
	return nil
}

// POST /api/backup/import   multipart/form-data: file
func (h *Handler) ImportBackup(c *gin.Context) {
	h.backupMu.Lock()
	defer h.backupMu.Unlock()

	if h.Cfg.MaxBackupUploadBytes > 0 {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.Cfg.MaxBackupUploadBytes+1024*1024)
	}
	fh, err := c.FormFile("file")
	if err != nil {
		badRequest(c, "没有收到备份文件")
		return
	}
	if h.Cfg.MaxBackupUploadBytes > 0 && fh.Size > h.Cfg.MaxBackupUploadBytes {
		badRequest(c, "备份包太大，上限 "+humanSize(h.Cfg.MaxBackupUploadBytes))
		return
	}

	tables, err := h.tableNames()
	if err != nil {
		serverErr(c, err)
		return
	}

	// 上传的 zip 落到临时文件再解析：备份包可能几百 MB，不能整体读进内存
	tmpZip, err := os.CreateTemp("", "wb-backup-*.zip")
	if err != nil {
		serverErr(c, err)
		return
	}
	tmpZipPath := tmpZip.Name()
	// defer 顺序：先关 zip 读取器再删临时文件（Windows 上句柄没关会删不掉）
	defer os.Remove(tmpZipPath)
	src, err := fh.Open()
	if err != nil {
		serverErr(c, err)
		return
	}
	_, err = io.Copy(tmpZip, src)
	src.Close()
	if err == nil {
		err = tmpZip.Close()
	}
	if err != nil {
		serverErr(c, err)
		return
	}

	zr, err := zip.OpenReader(tmpZipPath)
	if err != nil {
		badRequest(c, "不是有效的 zip 备份包")
		return
	}
	defer zr.Close()

	var manifestEntry, dbEntry *zip.File
	var uploadEntries []*zip.File
	for _, f := range zr.File {
		if err := validZipName(f.Name); err != nil {
			badRequest(c, "备份包包含非法路径 "+f.Name)
			return
		}
		switch {
		case f.Name == backupManifestEntry:
			manifestEntry = f
		case f.Name == backupDBEntry:
			dbEntry = f
		case strings.HasPrefix(f.Name, backupUploadsPrefix):
			uploadEntries = append(uploadEntries, f)
		default:
			badRequest(c, "备份包包含无法识别的文件 "+f.Name)
			return
		}
	}
	if manifestEntry == nil || dbEntry == nil {
		badRequest(c, "备份包缺少数据库或清单文件")
		return
	}

	var mf backupManifest
	if mr, err := manifestEntry.Open(); err != nil {
		badRequest(c, "清单文件无法读取")
		return
	} else {
		err = json.NewDecoder(mr).Decode(&mf)
		mr.Close()
	}
	if err != nil {
		badRequest(c, "清单文件解析失败")
		return
	}
	if mf.App != backupAppName {
		badRequest(c, "这不是本应用的备份包")
		return
	}
	if mf.Version > backupFormatVersion {
		badRequest(c, "备份包版本过新，请先升级服务端再导入")
		return
	}
	if mf.Version < backupFormatVersion {
		badRequest(c, "备份包版本过旧，无法导入")
		return
	}

	tmpDir, err := os.MkdirTemp("", "wb-import-*")
	if err != nil {
		serverErr(c, err)
		return
	}
	defer os.RemoveAll(tmpDir)

	// 先把数据库和图片全部解到临时目录：zip 的 CRC 校验在读的时候做，
	// 任何损坏在这里就会暴露，还碰不到现有数据
	restoreDBPath := filepath.Join(tmpDir, backupDBEntry)
	if err := extractZipFile(dbEntry, restoreDBPath); err != nil {
		serverErr(c, fmt.Errorf("解压数据库失败: %w", err))
		return
	}
	for _, f := range uploadEntries {
		dst := filepath.Join(tmpDir, filepath.FromSlash(f.Name))
		if err := extractZipFile(f, dst); err != nil {
			serverErr(c, fmt.Errorf("解压图片失败: %w", err))
			return
		}
	}

	if err := verifyBackupDB(restoreDBPath, tables); err != nil {
		badRequest(c, err.Error())
		return
	}

	currentR2 := map[string]string{}
	for _, key := range r2SettingKeys {
		currentR2[key] = h.settingValue(key)
	}
	counts, err := h.restoreDatabase(restoreDBPath, tables)
	if err != nil {
		serverErr(c, err)
		return
	}
	// R2 凭据与当前机器绑定，不随备份迁移；恢复后保留当前设置，
	// 由用户在新环境设置页重新配置。
	for key, value := range currentR2 {
		if err := h.saveSetting(key, value); err != nil {
			serverErr(c, err)
			return
		}
	}

	// 库已换血，再把图片搬进当前存储。内容寻址：同名即同内容，已存在就跳过。
	filesRestored, filesSkipped := 0, 0
	r2, err := h.r2Client()
	if err != nil {
		serverErr(c, err)
		return
	}
	for _, f := range uploadEntries {
		rel := strings.TrimPrefix(f.Name, backupUploadsPrefix)
		if r2 != nil {
			src, openErr := f.Open()
			if openErr != nil {
				serverErr(c, openErr)
				return
			}
			data, readErr := io.ReadAll(src)
			src.Close()
			if readErr != nil {
				serverErr(c, readErr)
				return
			}
			ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
			err := r2.Put(ctx, "uploads/"+rel, bytes.NewReader(data), int64(len(data)), "application/octet-stream")
			cancel()
			if err != nil {
				serverErr(c, fmt.Errorf("图片写入 R2 失败: %w", err))
				return
			}
			filesRestored++
			continue
		}
		dst := filepath.Join(h.Cfg.UploadDir, filepath.FromSlash(rel))
		if err := ensureInsideDir(h.Cfg.UploadDir, dst); err != nil {
			badRequest(c, "备份包包含可疑的图片路径 "+f.Name)
			return
		}
		if _, err := os.Stat(dst); err == nil {
			filesSkipped++
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			serverErr(c, err)
			return
		}
		if err := copyFile(filepath.Join(tmpDir, filepath.FromSlash(f.Name)), dst); err != nil {
			serverErr(c, fmt.Errorf("图片落盘失败: %w", err))
			return
		}
		filesRestored++
	}

	// 备份里的附件统一指向当前存储；旧备份没有 storage 列时也在这里纠正
	storageKind := "local"
	if r2 != nil {
		storageKind = "r2"
	}
	if err := h.DB.Model(&model.Attachment{}).Where("1 = 1").
		Update("storage", storageKind).Error; err != nil {
		serverErr(c, err)
		return
	}
	// 备份可能来自旧版本：结构对齐一下，缺的列由 AutoMigrate 补上
	if err := h.DB.AutoMigrate(model.AllModels()...); err != nil {
		serverErr(c, fmt.Errorf("对齐数据库结构失败: %w", err))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":            true,
		"counts":        counts,
		"filesRestored": filesRestored,
		"filesSkipped":  filesSkipped,
	})
}

func stripSettings(dbPath string, keys []string) error {
	db, err := sql.Open("sqlite", filepath.ToSlash(dbPath)+"?_pragma=busy_timeout(2000)")
	if err != nil {
		return err
	}
	defer db.Close()
	for _, key := range keys {
		if _, err := db.Exec("DELETE FROM settings WHERE `key` = ?", key); err != nil {
			return err
		}
	}
	return nil
}

// zip 条目路径校验：拒绝绝对路径、反斜杠、. 和 ..（zip-slip）
func validZipName(name string) error {
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") {
		return fmt.Errorf("非法路径")
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return fmt.Errorf("非法路径")
		}
	}
	return nil
}

// 目标路径必须落在 root 目录之内（防 zip-slip 的第二道保险）
func ensureInsideDir(root, dst string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	dstAbs, err := filepath.Abs(dst)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(rootAbs, dstAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("路径越界")
	}
	return nil
}

func extractZipFile(f *zip.File, dst string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, rc)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// 只读打开备份库，确认是个能用的 SQLite，且业务表齐全
func verifyBackupDB(path string, tables []string) error {
	db, err := sql.Open("sqlite", filepath.ToSlash(path)+"?_pragma=busy_timeout(2000)&_pragma=query_only(1)")
	if err != nil {
		return err
	}
	defer db.Close()
	var check string
	if err := db.QueryRow("PRAGMA quick_check").Scan(&check); err != nil {
		return fmt.Errorf("备份库无法读取: %w", err)
	}
	if check != "ok" {
		return fmt.Errorf("备份库完整性校验失败: %s", check)
	}
	have := map[string]bool{}
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table'")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		have[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, t := range tables {
		if !have[t] {
			return fmt.Errorf("备份包缺少数据表 %s，备份与应用版本可能不匹配", t)
		}
	}
	return nil
}

// 换血主流程：独立连接挂载备份库，单事务内清空业务表再整表拷回。
// 不动主连接（app 继续用它），事务提交前其他请求看到的还是旧数据。
func (h *Handler) restoreDatabase(backupPath string, tables []string) (map[string]int64, error) {
	// ATTACH 是连接级的，MaxOpenConns(1) 保证所有语句走同一条物理连接
	restore, err := sql.Open("sqlite", filepath.ToSlash(h.Cfg.DBPath)+"?_pragma=busy_timeout(30000)&_pragma=foreign_keys(0)")
	if err != nil {
		return nil, err
	}
	restore.SetMaxOpenConns(1)
	defer restore.Close()

	detach := func() { _, _ = restore.Exec(`DETACH DATABASE "_wbrestore"`) }
	attach := `ATTACH DATABASE '` + strings.ReplaceAll(filepath.ToSlash(backupPath), "'", "''") + `' AS "_wbrestore"`
	if _, err := restore.Exec(attach); err != nil {
		return nil, fmt.Errorf("挂载备份库失败: %w", err)
	}

	if _, err := restore.Exec("BEGIN IMMEDIATE"); err != nil {
		detach()
		return nil, fmt.Errorf("开启恢复事务失败: %w", err)
	}

	counts := make(map[string]int64, len(tables))
	for _, t := range tables {
		if _, err := restore.Exec(`DELETE FROM "` + t + `"`); err != nil {
			_, _ = restore.Exec("ROLLBACK")
			detach()
			return nil, fmt.Errorf("清空 %s 失败: %w", t, err)
		}
	}
	for _, t := range tables {
		n, err := copyTable(restore, t)
		if err != nil {
			_, _ = restore.Exec("ROLLBACK")
			detach()
			return nil, err
		}
		counts[t] = n
	}

	if _, err := restore.Exec("COMMIT"); err != nil {
		_, _ = restore.Exec("ROLLBACK")
		detach()
		return nil, fmt.Errorf("提交恢复事务失败: %w", err)
	}
	detach()
	return counts, nil
}

// 两库列名取交集、按名对齐后整表拷回。
// 旧版本的备份恢复到新库上时，新增的列走默认值，随后 AutoMigrate 补结构；
// 显式列出列名而不是 SELECT *，避免两边列数不一致直接报错。
func copyTable(db *sql.DB, table string) (int64, error) {
	mainCols, err := tableColumns(db, "main", table)
	if err != nil {
		return 0, fmt.Errorf("读取表结构 %s 失败: %w", table, err)
	}
	backCols, err := tableColumns(db, "_wbrestore", table)
	if err != nil {
		return 0, fmt.Errorf("读取备份表结构 %s 失败: %w", table, err)
	}
	inBackup := make(map[string]bool, len(backCols))
	for _, c := range backCols {
		inBackup[c] = true
	}
	var cols []string
	for _, c := range mainCols {
		if inBackup[c] {
			cols = append(cols, `"`+c+`"`)
		}
	}
	if len(cols) == 0 {
		return 0, fmt.Errorf("表 %s 与备份没有共同列", table)
	}
	list := strings.Join(cols, ",")
	res, err := db.Exec(`INSERT INTO "` + table + `" (` + list + `) SELECT ` + list + ` FROM "_wbrestore"."` + table + `"`)
	if err != nil {
		return 0, fmt.Errorf("恢复 %s 失败: %w", table, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return n, nil
}

func tableColumns(db *sql.DB, schema, table string) ([]string, error) {
	rows, err := db.Query(`PRAGMA ` + schema + `.table_info('` + table + `')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid, notNull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}

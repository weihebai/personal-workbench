package handler

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"personal-workbench/internal/config"
	"personal-workbench/internal/model"
)

type Handler struct {
	DB  *gorm.DB
	Cfg *config.Config

	// 备份导入是「清空再灌入」的全量替换，进行中不允许第二个并发导入
	backupMu sync.Mutex
}

func New(db *gorm.DB, cfg *config.Config) *Handler { return &Handler{DB: db, Cfg: cfg} }

// R2 配置存设置表。Secret 用 data/.r2_secret 派生密钥加密，
// 备份包不含这个文件，换服务器后需重新填写 R2 密钥。
const (
	r2AccountKey         = "r2_account_id"
	r2BucketKey          = "r2_bucket"
	r2CredentialIDKey    = "v2_access_key_id"
	r2CredentialValueKey = "v2_secret_access_key"
	r2JurisdictionKey    = "r2_jurisdiction"
	r2ConfiguredKey      = "r2_configured"
	secretCipherLabel    = "workbench-r2-secret-v2"
)

func (h *Handler) localSecretKey() ([]byte, error) {
	path := filepath.Join(".", ".r2_secret")
	if h.Cfg.DBPath != "" {
		path = filepath.Join(filepath.Dir(h.Cfg.DBPath), ".r2_secret")
	}
	if b, err := os.ReadFile(path); err == nil && len(b) >= 32 {
		return b[:32], nil
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, buf, 0o600); err != nil {
		return nil, err
	}
	return buf, nil
}

func (h *Handler) encryptSecret(v string) (string, error) {
	if v == "" {
		return "", nil
	}
	key, err := h.localSecretKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(v), []byte(secretCipherLabel))
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (h *Handler) decryptSecret(v string) (string, error) {
	if v == "" {
		return "", nil
	}
	key, err := h.localSecretKey()
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(v)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("R2 密钥数据损坏")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte(secretCipherLabel))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func (h *Handler) settingValue(key string) string {
	var s model.Setting
	if err := h.DB.Where("`key` = ?", key).First(&s).Error; err != nil {
		return ""
	}
	return s.Value
}

func (h *Handler) saveSetting(key, value string) error {
	if value == "" {
		return h.DB.Delete(&model.Setting{}, "`key` = ?", key).Error
	}
	var s model.Setting
	if err := h.DB.Where("`key` = ?", key).First(&s).Error; err != nil {
		s = model.Setting{Key: key}
	}
	s.Value = value
	return h.DB.Save(&s).Error
}

// ---------- 通用工具 ----------

func fail(c *gin.Context, code int, msg string) {
	c.JSON(code, gin.H{"error": msg})
}

func badRequest(c *gin.Context, msg string) { fail(c, http.StatusBadRequest, msg) }
func notFound(c *gin.Context, msg string)   { fail(c, http.StatusNotFound, msg) }
func serverErr(c *gin.Context, err error)   { fail(c, http.StatusInternalServerError, err.Error()) }

func paramUint(c *gin.Context, key string) (uint, bool) {
	v, err := strconv.ParseUint(c.Param(key), 10, 64)
	if err != nil || v == 0 {
		badRequest(c, "无效的 "+key)
		return 0, false
	}
	return uint(v), true
}

func queryUint(c *gin.Context, key string) *uint {
	s := c.Query(key)
	if s == "" {
		return nil
	}
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return nil
	}
	u := uint(v)
	return &u
}

// Paginate 统一分页
func paginate(c *gin.Context) (page, size int) {
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ = strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 20
	}
	return
}

func paginated(items any, total int64, page, size int) gin.H {
	return gin.H{
		"items": items,
		"total": total,
		"page":  page,
		"size":  size,
		"pages": int(math.Ceil(float64(total) / float64(size))),
	}
}

func mustParseDate(s string) *time.Time {
	if s == "" {
		return nil
	}
	layouts := []string{time.RFC3339, "2006-01-02T15:04:05Z07:00", "2006-01-02"}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return &t
		}
	}
	return nil
}

func isNotFound(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }

// JSON 里数字一律解成 float64、字符串解成 string，
// 局部更新时统一转一下，省得每个 handler 各写一份类型断言。
func toString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

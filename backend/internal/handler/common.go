package handler

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"personal-workbench/internal/config"
)

type Handler struct {
	DB  *gorm.DB
	Cfg *config.Config
}

func New(db *gorm.DB, cfg *config.Config) *Handler { return &Handler{DB: db, Cfg: cfg} }

// ---------- 通用工具 ----------

func fail(c *gin.Context, code int, msg string) {
	c.JSON(code, gin.H{"error": msg})
}

func badRequest(c *gin.Context, msg string) { fail(c, http.StatusBadRequest, msg) }
func notFound(c *gin.Context, msg string)  { fail(c, http.StatusNotFound, msg) }
func serverErr(c *gin.Context, err error)  { fail(c, http.StatusInternalServerError, err.Error()) }

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

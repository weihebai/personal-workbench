package auth

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UID  uint   `json:"uid"`
	Name string `json:"name"`
	jwt.RegisteredClaims
}

type Manager struct {
	secret []byte
	ttl    time.Duration
}

func New(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl}
}

func (m *Manager) Sign(uid uint, name string) (string, error) {
	now := time.Now()
	claims := Claims{
		UID:  uid,
		Name: name,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
			Issuer:    "personal-workbench",
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
}

func (m *Manager) Parse(token string) (*Claims, error) {
	t, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := t.Claims.(*Claims)
	if !ok || !t.Valid {
		return nil, errors.New("invalid token")
	}
	return c, nil
}

// Middleware 校验 Bearer token
func (m *Manager) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		token := ""
		if strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
		}
		if token == "" {
			// 兼容 SSE / 下载场景
			token = c.Query("token")
		}
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
			return
		}
		claims, err := m.Parse(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "登录已过期"})
			return
		}
		c.Set("uid", claims.UID)
		c.Set("uname", claims.Name)
		c.Next()
	}
}

// Limiter 登录失败限流：同一 IP 连续失败 N 次后锁定
type Limiter struct {
	mu       sync.Mutex
	fails    map[string]*entry
	maxFails int
	lockFor  time.Duration
}

type entry struct {
	count int
	until time.Time
}

func NewLimiter(maxFails int, lockFor time.Duration) *Limiter {
	return &Limiter{fails: map[string]*entry{}, maxFails: maxFails, lockFor: lockFor}
}

// Allow 是否允许尝试
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.fails[key]
	if !ok {
		return true, 0
	}
	if !e.until.IsZero() {
		if time.Now().Before(e.until) {
			return false, time.Until(e.until)
		}
		delete(l.fails, key)
	}
	return true, 0
}

func (l *Limiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.fails[key]
	if !ok {
		e = &entry{}
		l.fails[key] = e
	}
	e.count++
	if e.count >= l.maxFails {
		e.until = time.Now().Add(l.lockFor)
		e.count = 0
	}
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, key)
}

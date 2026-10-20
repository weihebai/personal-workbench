package handler

import (
	"testing"
	"time"
)

func d(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestAddWorkdays(t *testing.T) {
	cases := []struct {
		start string
		n     int
		want  string
	}{
		{"2026-10-20", 1, "2026-10-21"},  // 周二 +1 = 周三
		{"2026-10-20", 3, "2026-10-23"},  // 周二 +3 = 周五
		{"2026-10-20", 4, "2026-10-26"},  // 跨过周末
		{"2026-10-20", 12, "2026-11-05"}, // 12 个工作日
		{"2026-10-23", 1, "2026-10-26"},  // 周五 +1 = 下周一
		{"2026-10-24", 1, "2026-10-26"},  // 周六起算 +1 = 周一
		{"2026-10-25", 1, "2026-10-26"},  // 周日起算 +1 = 周一
		{"2026-10-20", 0, "2026-10-20"},  // 0 天 = 当天
	}
	for _, c := range cases {
		got := addWorkdays(d(c.start), c.n).Format("2006-01-02")
		if got != c.want {
			t.Errorf("addWorkdays(%s, %d) = %s, want %s", c.start, c.n, got, c.want)
		}
	}
}

func TestAddNaturalDays(t *testing.T) {
	if got := addNaturalDays(d("2026-10-20"), 12).Format("2006-01-02"); got != "2026-11-01" {
		t.Errorf("got %s, want 2026-11-01", got)
	}
}

func TestCountWorkdaysBetween(t *testing.T) {
	// 10/19(周一) ~ 10/23(周五) 含首尾 = 5 个工作日
	if got := countWorkdaysBetween(d("2026-10-19"), d("2026-10-23")); got != 5 {
		t.Errorf("got %d, want 5", got)
	}
	// 同一周末日应为 0
	if got := countWorkdaysBetween(d("2026-10-24"), d("2026-10-25")); got != 0 {
		t.Errorf("got %d, want 0", got)
	}
}

func TestDaysUntil(t *testing.T) {
	tomorrow := time.Now().AddDate(0, 0, 1)
	if got := daysUntil(tomorrow); got != 1 {
		t.Errorf("tomorrow daysUntil = %d, want 1", got)
	}
	yesterday := time.Now().AddDate(0, 0, -1)
	if got := daysUntil(yesterday); got != -1 {
		t.Errorf("yesterday daysUntil = %d, want -1", got)
	}
}

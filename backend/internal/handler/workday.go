package handler

import (
	"time"
)

// addWorkdays 从 start 起顺延 n 个工作日（跳过周六周日），start 当天不计入。
// 例：2026-10-20(周二) + 12 工作日 = 2026-11-05(周四)
func addWorkdays(start time.Time, n int) time.Time {
	d := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
	if n <= 0 {
		return d
	}
	added := 0
	for added < n {
		d = d.AddDate(0, 0, 1)
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			added++
		}
	}
	return d
}

// addNaturalDays 自然日顺延
func addNaturalDays(start time.Time, n int) time.Time {
	d := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
	return d.AddDate(0, 0, n)
}

// computeDue 根据起始日、天数与类型推算目标日期
func computeDue(start *time.Time, days int, dayType string) *time.Time {
	if start == nil || days <= 0 {
		return nil
	}
	var due time.Time
	if dayType == "natural" {
		due = addNaturalDays(*start, days)
	} else {
		due = addWorkdays(*start, days)
	}
	return &due
}

// countWorkdaysBetween 计算两个日期之间的工作日数（含首尾，用于回填工期）
func countWorkdaysBetween(from, to time.Time) int {
	a := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, from.Location())
	b := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, to.Location())
	if b.Before(a) {
		return 0
	}
	n := 0
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			n++
		}
	}
	return n
}

// daysUntil 目标日期距今天数（按自然日，负数表示已过期）
func daysUntil(t time.Time) int {
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	target := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
	return int(target.Sub(today).Hours() / 24)
}

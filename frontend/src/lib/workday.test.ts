import { describe, expect, it } from 'vitest'
import { daysLeftText, daysUntil, fmtDateCn, parseDateOnly, toISO } from './workday'

describe('parseDateOnly', () => {
  it('按本地时区构造日期，不受 UTC 偏移影响', () => {
    const d = parseDateOnly('2026-10-20')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(20)
  })

  it('非法输入返回 null', () => {
    expect(parseDateOnly('')).toBeNull()
    expect(parseDateOnly('2026/10/20')).toBeNull()
  })
})

describe('日期展示', () => {
  it('fmtDateCn 带星期', () => {
    expect(fmtDateCn(new Date(2026, 10, 5))).toBe('2026年11月5日 周四')
  })

  it('toISO 使用本地年月日', () => {
    expect(toISO(new Date(2026, 0, 1, 23, 30))).toBe('2026-01-01')
  })

  it('daysLeftText 覆盖今天/未来/过期', () => {
    expect(daysLeftText(0)).toBe('今天到期')
    expect(daysLeftText(3)).toBe('还剩 3 天')
    expect(daysLeftText(-2)).toBe('已过期 2 天')
  })
})

describe('daysUntil', () => {
  const now = new Date()
  const day = (off: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off)

  it('按自然日计算', () => {
    expect(daysUntil(day(1))).toBe(1)
    expect(daysUntil(day(-1))).toBe(-1)
    expect(daysUntil(day(0))).toBe(0)
  })
})

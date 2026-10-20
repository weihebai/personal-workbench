/** 工作日推算（与后端 workday.go 保持一致的算法） */

const pad = (n: number) => String(n).padStart(2, '0')

function normalize(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 顺延 n 个工作日，起始日不计入 */
export function addWorkdays(start: Date, n: number): Date {
  const d = normalize(start)
  if (n <= 0) return d
  let added = 0
  while (added < n) {
    d.setDate(d.getDate() + 1)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) added++
  }
  return d
}

/** 顺延 n 个自然日 */
export function addNaturalDays(start: Date, n: number): Date {
  const d = normalize(start)
  d.setDate(d.getDate() + n)
  return d
}

/** 中文日期：2026年11月5日 周四 */
export function fmtDateCn(d: Date): string {
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wd}`
}

/** 距今天数（按自然日，负数=已过期） */
export function daysUntil(target: string | Date): number {
  const t = typeof target === 'string' ? new Date(target) : target
  const now = new Date()
  const a = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/** 剩余天数的人类可读文案 */
export function daysLeftText(days: number): string {
  if (days === 0) return '今天到期'
  if (days > 0) return `还剩 ${days} 天`
  return `已过期 ${Math.abs(days)} 天`
}

/** 把 Date 转成 YYYY-MM-DD */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 日期展示工具。
 * 工作日/自然日的到期推算统一走后端 /api/workdays/preview，
 * 前端不再保留第二份算法，避免两边改一处漏一处。
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** 解析 YYYY-MM-DD，按本地时区构造，避免 new Date(str) 在负时区偏一天 */
export function parseDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
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

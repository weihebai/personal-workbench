import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 金额格式化：12345.6 -> ¥12,345.60 */
export function money(v?: number | null, withSymbol = true) {
  const n = Number(v ?? 0)
  const s = n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return withSymbol ? `¥${s}` : s
}

/** 紧凑金额：12345 -> 1.2万 */
export function moneyCompact(v?: number | null) {
  const n = Number(v ?? 0)
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)}万`
  return n.toLocaleString('zh-CN')
}

export function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fmtDateShort(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}`
}

export function toDateInput(v?: string | null) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function minutesToHours(m?: number) {
  const n = Number(m ?? 0)
  if (!n) return '0h'
  return `${(n / 60).toFixed(n % 60 === 0 ? 0 : 1)}h`
}

export function daysBetween(a: string | Date, b: string | Date = new Date()) {
  const d1 = new Date(a).getTime()
  const d2 = new Date(b).getTime()
  return Math.ceil((d1 - d2) / 86400000)
}

/* ---------- 业务字典 ---------- */

export const PROJECT_KIND = {
  company: { label: '公司项目', color: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700 border-sky-200' },
  outsource: { label: '外包私活', color: 'bg-brand-500', soft: 'bg-brand-50 text-brand-700 border-brand-200' },
  personal: { label: '个人项目', color: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700 border-violet-200' },
} as const

export const PROJECT_STATUS = {
  negotiating: { label: '洽谈中', color: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700 border-amber-200' },
  active: { label: '进行中', color: 'bg-brand-500', soft: 'bg-brand-50 text-brand-700 border-brand-200' },
  delivered: { label: '已交付', color: 'bg-cyan-500', soft: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  paid: { label: '已结款', color: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  paused: { label: '已暂停', color: 'bg-ink-400', soft: 'bg-ink-100 text-ink-500 border-ink-200' },
  archived: { label: '已归档', color: 'bg-ink-300', soft: 'bg-ink-50 text-ink-400 border-ink-200' },
} as const

export const TASK_STATUS = {
  todo: { label: '待办', color: 'bg-ink-400', soft: 'bg-ink-100 text-ink-600 border-ink-200' },
  doing: { label: '进行中', color: 'bg-brand-500', soft: 'bg-brand-50 text-brand-700 border-brand-200' },
  done: { label: '已完成', color: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  canceled: { label: '已取消', color: 'bg-ink-300', soft: 'bg-ink-50 text-ink-400 border-ink-200' },
} as const

export const TASK_PRIORITY = {
  low: { label: '低', color: 'bg-ink-300', soft: 'bg-ink-50 text-ink-500 border-ink-200' },
  normal: { label: '普通', color: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700 border-sky-200' },
  high: { label: '高', color: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700 border-amber-200' },
  urgent: { label: '紧急', color: 'bg-red-500', soft: 'bg-red-50 text-red-700 border-red-200' },
} as const

export const PAYMENT_STATUS = {
  pending: { label: '待收', color: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700 border-amber-200' },
  received: { label: '已收', color: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  overdue: { label: '已逾期', color: 'bg-red-500', soft: 'bg-red-50 text-red-700 border-red-200' },
} as const

export const REMINDER_CATEGORY = {
  certificate: { label: 'SSL 证书', color: 'bg-rose-500', soft: 'bg-rose-50 text-rose-700 border-rose-200' },
  domain: { label: '域名', color: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700 border-sky-200' },
  server: { label: '服务器', color: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700 border-violet-200' },
  client: { label: '客户续费', color: 'bg-brand-500', soft: 'bg-brand-50 text-brand-700 border-brand-200' },
  other: { label: '其他', color: 'bg-ink-400', soft: 'bg-ink-100 text-ink-600 border-ink-200' },
} as const

export const MILESTONE_STATUS = {
  waiting: { label: '等待中', color: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700 border-sky-200' },
  done: { label: '已完成', color: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  delayed: { label: '已延期', color: 'bg-red-500', soft: 'bg-red-50 text-red-700 border-red-200' },
  canceled: { label: '已取消', color: 'bg-ink-300', soft: 'bg-ink-50 text-ink-400 border-ink-200' },
} as const

export const CLIENT_SOURCES = ['闲鱼', '小红书', '熟人介绍', '公司', '抖音', '其他'] as const

export function dictOf<T extends Record<string, { label: string; color: string; soft: string }>>(
  d: T,
  k?: string | null,
) {
  if (k && k in d) return d[k as keyof T]
  return { label: k || '—', color: 'bg-ink-300', soft: 'bg-ink-50 text-ink-500 border-ink-200' }
}

import type { Content, ContentStatus } from './api'
import { fmtDate } from './utils'

/** 内容库：四种固定类型 */
export const CONTENT_KIND = {
  pitfall: {
    label: '经验避坑',
    color: 'bg-rose-500',
    soft: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  article: {
    label: '文章草稿',
    color: 'bg-sky-500',
    soft: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  client: {
    label: '客户素材',
    color: 'bg-brand-500',
    soft: 'bg-brand-50 text-brand-700 border-brand-200',
  },
  note: {
    label: '笔记',
    color: 'bg-violet-500',
    soft: 'bg-violet-50 text-violet-700 border-violet-200',
  },
} as const

/** 内容库：个人整理状态，和分享是否开启无关 */
export const CONTENT_STATUS: Record<
  ContentStatus,
  { label: string; color: string; soft: string }
> = {
  draft: { label: '草稿', color: 'bg-ink-400', soft: 'bg-ink-100 text-ink-600 border-ink-200' },
  ready: { label: '待发', color: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700 border-amber-200' },
  published: {
    label: '已发布',
    color: 'bg-emerald-500',
    soft: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  archived: { label: '已归档', color: 'bg-ink-300', soft: 'bg-ink-50 text-ink-400 border-ink-200' },
}

export type ShareState = 'none' | 'active' | 'expired'

export function shareState(c: Pick<Content, 'shareEnabled' | 'shareExpired'>): ShareState {
  if (c.shareExpired) return 'expired'
  if (c.shareEnabled) return 'active'
  return 'none'
}

/** 到期文案：空 = 永久有效；过去 = 已过期 */
export function expiryLabel(expiresAt?: string | null, now: Date = new Date()): string {
  if (!expiresAt) return '永久有效'
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return '永久有效'
  if (d.getTime() <= now.getTime()) return '已过期'
  return `${fmtDate(expiresAt)} 到期`
}

/** 后台返回的是 /share/xxx 路径，拼成可复制的完整地址 */
export function shareUrl(path?: string | null): string {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${path}`
}

/** 分享有效期选项，和后端约定一致 */
export const SHARE_EXPIRY_OPTIONS = [
  { value: 0, label: '永久有效' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
] as const

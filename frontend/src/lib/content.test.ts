import { describe, expect, it } from 'vitest'
import {
  CONTENT_KIND,
  CONTENT_STATUS,
  SHARE_EXPIRY_OPTIONS,
  expiryLabel,
  shareState,
  shareUrl,
} from './content'

describe('内容字典', () => {
  it('四种类型文案齐全', () => {
    expect(Object.keys(CONTENT_KIND)).toEqual(['pitfall', 'article', 'client', 'note'])
    expect(CONTENT_KIND.pitfall.label).toBe('经验避坑')
    expect(CONTENT_KIND.article.label).toBe('文章草稿')
    expect(CONTENT_KIND.client.label).toBe('客户素材')
    expect(CONTENT_KIND.note.label).toBe('笔记')
    for (const v of Object.values(CONTENT_KIND)) {
      expect(v.soft).toBeTruthy()
      expect(v.color).toBeTruthy()
    }
  })

  it('四种状态文案齐全', () => {
    expect(Object.keys(CONTENT_STATUS)).toEqual(['draft', 'ready', 'published', 'archived'])
    expect(CONTENT_STATUS.draft.label).toBe('草稿')
    expect(CONTENT_STATUS.ready.label).toBe('待发')
    expect(CONTENT_STATUS.published.label).toBe('已发布')
    expect(CONTENT_STATUS.archived.label).toBe('已归档')
  })

  it('有效期选项为永久 / 7 天 / 30 天', () => {
    expect(SHARE_EXPIRY_OPTIONS.map((o) => o.value)).toEqual([0, 7, 30])
  })
})

describe('shareState', () => {
  it('未分享', () => {
    expect(shareState({ shareEnabled: false, shareExpired: false })).toBe('none')
  })
  it('有效分享', () => {
    expect(shareState({ shareEnabled: true, shareExpired: false })).toBe('active')
  })
  it('过期优先于启用', () => {
    expect(shareState({ shareEnabled: false, shareExpired: true })).toBe('expired')
    expect(shareState({ shareEnabled: true, shareExpired: true })).toBe('expired')
  })
})

describe('expiryLabel', () => {
  const now = new Date('2026-10-22T12:00:00+08:00')

  it('没有到期时间 = 永久有效', () => {
    expect(expiryLabel(null, now)).toBe('永久有效')
    expect(expiryLabel(undefined, now)).toBe('永久有效')
  })
  it('未来时间显示到期日', () => {
    expect(expiryLabel('2026-10-29T12:00:00+08:00', now)).toBe('2026-10-29 到期')
  })
  it('过去时间 = 已过期', () => {
    expect(expiryLabel('2026-10-21T12:00:00+08:00', now)).toBe('已过期')
  })
  it('非法时间按永久处理', () => {
    expect(expiryLabel('not-a-date', now)).toBe('永久有效')
  })
})

describe('shareUrl', () => {
  it('相对路径拼上当前域名', () => {
    expect(shareUrl('/share/abc')).toBe(`${window.location.origin}/share/abc`)
  })
  it('绝对地址原样返回', () => {
    expect(shareUrl('https://example.com/share/x')).toBe('https://example.com/share/x')
  })
  it('空路径返回空串', () => {
    expect(shareUrl(null)).toBe('')
    expect(shareUrl('')).toBe('')
  })
})

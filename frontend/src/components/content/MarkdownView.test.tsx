import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

describe('MarkdownView', () => {
  it('渲染标题与 GFM 表格', () => {
    const md = '## 驳回原因\n\n| 字段 | 原因 |\n| --- | --- |\n| 证件 | 背景不一致 |'
    const { container } = render(<MarkdownView>{md}</MarkdownView>)
    expect(screen.getByRole('heading', { level: 2, name: '驳回原因' })).toBeInTheDocument()
    expect(container.querySelector('table')).toBeTruthy()
    expect(screen.getByText('背景不一致')).toBeInTheDocument()
  })

  it('javascript: 链接不会变成可点击的 href', () => {
    render(<MarkdownView>{'[点我](javascript:alert(1))'}</MarkdownView>)
    const link = screen.getByText('点我')
    expect(link.getAttribute('href') ?? '').not.toContain('javascript')
  })

  it('原始 HTML 不进入 DOM', () => {
    const md = '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">'
    const { container } = render(<MarkdownView>{md}</MarkdownView>)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('外链带安全属性', () => {
    render(<MarkdownView>{'[x](https://example.com)'}</MarkdownView>)
    const link = screen.getByText('x')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow')
  })

  it('图片懒加载且不带 Referer', () => {
    const { container } = render(<MarkdownView>{'![图](/api/attachments/abc/raw)'}</MarkdownView>)
    const img = container.querySelector('img')!
    expect(img).toBeTruthy()
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img.getAttribute('src')).toBe('/api/attachments/abc/raw')
  })

  it('点击图片在弹窗内预览，不跳新标签', () => {
    const { container } = render(<MarkdownView>{'![截图](/api/attachments/abc/raw)'}</MarkdownView>)
    expect(container.querySelector('a')).toBeNull()

    fireEvent.click(screen.getByTitle('点击预览'))
    const dialog = screen.getByRole('dialog', { name: '图片预览' })
    expect(dialog).toBeInTheDocument()
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/api/attachments/abc/raw')

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('链接里的图片也优先弹窗预览', () => {
    render(<MarkdownView>{'[![截图](/api/attachments/abc/raw)](https://example.com)'}</MarkdownView>)
    fireEvent.click(screen.getByTitle('点击预览'))
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument()
  })
})

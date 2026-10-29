import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicSharePage from './PublicSharePage'
import { publicApi } from '@/lib/publicApi'
import type { PublicContent } from '@/lib/api'

vi.mock('@/lib/publicApi', () => ({
  publicApi: { get: vi.fn() },
}))

const content: PublicContent = {
  title: '微信小程序备案被驳回的 3 个原因',
  body: '## 驳回原因\n\n主体负责人证件背景不一致。',
  tags: ['微信小程序', '备案'],
  updatedAt: '2026-10-22T12:00:00+08:00',
  attachments: [{ url: '/api/attachments/abc/raw', width: 1200, height: 800 }],
}

function renderPage(token = 'abc123') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<PublicSharePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PublicSharePage', () => {
  beforeEach(() => {
    vi.mocked(publicApi.get).mockReset()
  })

  it('渲染标题、正文、标签和图片', async () => {
    vi.mocked(publicApi.get).mockResolvedValue({ data: content } as never)
    const { container } = renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: content.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '驳回原因' })).toBeInTheDocument()
    expect(screen.getByText('微信小程序')).toBeInTheDocument()
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/api/attachments/abc/raw')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(publicApi.get).toHaveBeenCalledWith('/contents/abc123')
  })

  it('页面没有编辑、删除、登录入口', async () => {
    vi.mocked(publicApi.get).mockResolvedValue({ data: content } as never)
    renderPage()

    await screen.findByRole('heading', { level: 1, name: content.title })
    for (const word of ['编辑', '删除', '登录']) {
      expect(screen.queryByText(word)).toBeNull()
      expect(screen.queryByRole('button', { name: new RegExp(word) })).toBeNull()
    }
  })

  it('点击附件图片在弹窗预览，不打开新标签', async () => {
    vi.mocked(publicApi.get).mockResolvedValue({ data: content } as never)
    const { container } = renderPage()

    await screen.findByRole('heading', { level: 1, name: content.title })
    expect(container.querySelector('a[href="/api/attachments/abc/raw"]')).toBeNull()

    fireEvent.click(screen.getByTitle('点击预览'))
    const dialog = screen.getByRole('dialog', { name: '图片预览' })
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/api/attachments/abc/raw')

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('404 / 网络错误统一显示失效文案', async () => {
    vi.mocked(publicApi.get).mockRejectedValue({ response: { status: 404 } } as never)
    renderPage('gone')

    expect(await screen.findByText('分享不存在或已失效')).toBeInTheDocument()
    expect(screen.queryByText(/404/)).toBeNull()
  })

  it('设置标题与 noindex / no-referrer meta', async () => {
    vi.mocked(publicApi.get).mockResolvedValue({ data: content } as never)
    const { unmount } = renderPage()

    await waitFor(() => expect(document.title).toBe(`${content.title} · 个人工作台`))
    await waitFor(() => {
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
        'noindex,nofollow',
      )
      expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe(
        'no-referrer',
      )
    })

    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })
})

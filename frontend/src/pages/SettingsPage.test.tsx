import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'
import { api, setToken } from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } }
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SettingsPage 修改密码', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { username: 'admin', nickname: '我' } } as never
      if (url === '/settings/r2') {
        return {
          data: { configured: false, accountId: '', bucket: '', accessKeyIdMasked: '', jurisdiction: '' },
        } as never
      }
      if (url === '/settings/mcp') return { data: { token: '', source: 'off' } } as never
      if (url === '/settings') return { data: { paymentCreditDays: '7' } } as never
      throw new Error('unexpected GET ' + url)
    })
    vi.mocked(api.post).mockReset()
  })

  it('成功后提示密码已更新', async () => {
    setToken('old-token')
    vi.mocked(api.post).mockResolvedValue({ data: { ok: true } } as never)
    const { container } = renderPage()

    const [oldInput, newInput] = Array.from(container.querySelectorAll('input[type="password"]'))
    await userEvent.type(oldInput, 'oldpass')
    await userEvent.type(newInput, 'newpass')
    await userEvent.click(screen.getByRole('button', { name: '更新密码' }))

    await waitFor(() => expect(screen.getByText('密码已更新')).toBeInTheDocument())
    expect(api.post).toHaveBeenCalledWith('/auth/password', {
      oldPassword: 'oldpass',
      newPassword: 'newpass',
    })
  })
})

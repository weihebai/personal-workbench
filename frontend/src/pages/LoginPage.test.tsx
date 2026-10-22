import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { post: vi.fn() } }
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset()
  })

  it('改密码跳转后提示重新登录', () => {
    renderAt('/login?reason=password')
    expect(screen.getByText('密码已更新，请重新登录')).toBeInTheDocument()
  })

  it('登录成功后保存 token', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { token: 't1' } } as never)
    renderAt('/login')

    await userEvent.type(screen.getByPlaceholderText('请输入用户名'), 'admin')
    await userEvent.type(screen.getByPlaceholderText('请输入密码'), 'pass123')
    await userEvent.click(screen.getByRole('button', { name: /登录/ }))

    await waitFor(() => expect(localStorage.getItem('wb_token')).toBe('t1'))
  })
})

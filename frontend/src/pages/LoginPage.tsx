import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn, Sparkles } from 'lucide-react'
import { api, setToken, errMsg } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { username, password })
      setToken(data.token)
      navigate('/', { replace: true })
    } catch (e) {
      setErr(errMsg(e, '登录失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-50 px-4">
      {/* 高饱和光斑背景 */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-400/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-cyan-400/25 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-10 h-64 w-64 -translate-x-1/2 rounded-full bg-emerald-400/15 blur-3xl" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg shadow-brand-500/30">
            <Sparkles size={22} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">个人工作台</h1>
          <p className="mt-1 text-xs text-ink-400">项目 · 私活 · 收入，一个地方管清</p>
        </div>

        <form onSubmit={submit} className="card space-y-3.5 p-5 shadow-xl shadow-ink-900/5">
          <Field label="用户名">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
            />
          </Field>
          <Field label="密码">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </Field>
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
              {err}
            </div>
          )}
          <Button type="submit" className="w-full" loading={loading}>
            <LogIn size={15} />
            登录
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-ink-400">
          单用户私有工作台 · 数据仅存储在你的服务器
        </p>
      </div>
    </div>
  )
}

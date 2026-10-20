import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Wallet,
  BellRing,
  Users,
  Settings,
  Search,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEscClose } from '@/lib/useEscClose'
import { api, getToken, setToken, type DashboardData } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'

const nav = [
  { to: '/', label: '总览', icon: LayoutDashboard, exact: true },
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/tasks', label: '任务', icon: CheckSquare },
  { to: '/payments', label: '收款', icon: Wallet },
  { to: '/reminders', label: '到期提醒', icon: BellRing },
  { to: '/clients', label: '客户', icon: Users },
]

const mobileNav = nav.slice(0, 5)

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const { data } = useQuery({
    queryKey: ['dashboard-badges'],
    queryFn: async () => (await api.get<DashboardData>('/dashboard')).data,
    staleTime: 30_000,
  })

  useEffect(() => setMobileOpen(false), [location.pathname])

  const badges: Record<string, number> = {
    '/tasks': (data?.counts.todoTasks ?? 0) + (data?.counts.doingTasks ?? 0),
    '/reminders': (data?.counts.remindersSoon ?? 0) + (data?.counts.remindersExpired ?? 0),
  }

  const logout = () => {
    setToken(null)
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen">
      {/* 桌面侧栏 */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--border)] bg-white lg:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm shadow-brand-500/30">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 7h18M3 12h12M3 17h8" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-sm font-bold tracking-tight text-ink-900">工作台</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {nav.map((item) => {
            const Icon = item.icon
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to)
            const badge = badges[item.to] ?? 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
                )}
              >
                <Icon size={16} className={active ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-600'} />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span
                    className={cn(
                      'min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4',
                      item.to === '/reminders' ? 'bg-red-500 text-white' : 'bg-brand-500 text-white',
                    )}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-[var(--border)] p-2">
          <NavLink
            to="/settings"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            <Settings size={16} className="text-ink-400" />
            设置
          </NavLink>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-500 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={16} className="text-ink-400" />
            退出登录
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--border)] bg-white/90 px-3 backdrop-blur-md sm:px-5">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 lg:hidden"
            aria-label="菜单"
          >
            <Menu size={18} />
          </button>

          <div className="hidden items-center gap-2 rounded-md bg-emerald-50 px-2 py-1 lg:flex">
            <span className="dot bg-emerald-500" />
            <span className="tabular text-xs font-semibold text-emerald-700">
              已收 {data ? (data.finance.received).toLocaleString('zh-CN') : '—'}
            </span>
          </div>
          <div className="hidden items-center gap-2 rounded-md bg-amber-50 px-2 py-1 lg:flex">
            <span className="dot bg-amber-500" />
            <span className="tabular text-xs font-semibold text-amber-700">
              待收 {data ? (data.finance.pending).toLocaleString('zh-CN') : '—'}
            </span>
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2.5 text-xs text-ink-400 transition-colors hover:border-ink-300 hover:text-ink-600 sm:w-56"
          >
            <Search size={13} />
            <span className="hidden sm:inline">搜索项目、任务…</span>
            <kbd className="ml-auto hidden rounded border border-ink-200 px-1 text-[10px] text-ink-400 sm:inline">
              /
            </kbd>
          </button>
        </header>

        <main className="flex-1 px-3 pb-24 pt-4 sm:px-5 sm:pb-8">
          <Outlet />
        </main>

        {/* 移动端底部 Tab */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--border)] bg-white/95 backdrop-blur-md safe-bottom lg:hidden">
          {mobileNav.map((item) => {
            const Icon = item.icon
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to)
            const badge = badges[item.to] ?? 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2',
                  active ? 'text-brand-600' : 'text-ink-400',
                )}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
                <span className="text-[10px] font-medium">{item.label}</span>
                {badge > 0 && (
                  <span className="absolute right-1/2 top-1 -mr-4 min-w-4 rounded-full bg-red-500 px-1 text-center text-[9px] font-bold leading-4 text-white">
                    {badge > 99 ? '99' : badge}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>
      </div>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-64 bg-white p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold">工作台</span>
              <button onClick={() => setMobileOpen(false)} className="text-ink-400">
                <X size={18} />
              </button>
            </div>
            {[...nav, { to: '/settings', label: '设置', icon: Settings }].map((item) => {
              const Icon = item.icon
              const active = location.pathname === item.to
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium',
                    active ? 'bg-brand-50 text-brand-700' : 'text-ink-600',
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              )
            })}
            <button
              onClick={logout}
              className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-red-600"
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </div>
      )}

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
      <GlobalHotkeys onSearch={() => setSearchOpen(true)} />
    </div>
  )
}

function GlobalHotkeys({ onSearch }: { onSearch: () => void }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName) || el?.isContentEditable
      if (e.key === '/' && !typing) {
        e.preventDefault()
        onSearch()
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onSearch])
  return null
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<any>(null)
  useEscClose(true, onClose)
  const navigate = useNavigate()

  useEffect(() => {
    if (!q.trim()) {
      setRes(null)
      return
    }
    const t = setTimeout(async () => {
      const { data } = await api.get('/search', { params: { q } })
      setRes(data)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl animate-in">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
          <Search size={16} className="text-ink-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索项目、任务、提醒、客户…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
          />
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {!res && <p className="px-2 py-6 text-center text-xs text-ink-400">输入关键词开始搜索</p>}
          {res && (
            <>
              <SearchGroup<{ id: number; name: string }>
                title="项目"
                items={res.projects}
                onPick={(id) => go(`/projects/${id}`)}
                render={(p) => p.name}
              />
              <SearchGroup<{ id: number; title: string }>
                title="任务"
                items={res.tasks}
                onPick={() => go('/tasks')}
                render={(t) => t.title}
              />
              <SearchGroup<{ id: number; title: string }>
                title="提醒"
                items={res.reminders}
                onPick={() => go('/reminders')}
                render={(r) => r.title}
              />
              <SearchGroup<{ id: number; name: string }>
                title="客户"
                items={res.clients}
                onPick={() => go('/clients')}
                render={(c) => c.name}
              />
              {!res.projects.length && !res.tasks.length && !res.reminders.length && !res.clients.length && (
                <p className="px-2 py-6 text-center text-xs text-ink-400">没有找到匹配内容</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SearchGroup<T extends { id: number }>({
  title,
  items,
  onPick,
  render,
}: {
  title: string
  items: T[]
  onPick: (id: number) => void
  render: (item: T) => string
}) {
  if (!items?.length) return null
  return (
    <div className="mb-1">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onPick(it.id)}
          className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-ink-700 hover:bg-ink-50"
        >
          {render(it)}
        </button>
      ))}
    </div>
  )
}

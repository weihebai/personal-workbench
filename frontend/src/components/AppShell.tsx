import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Wallet,
  BellRing,
  Lightbulb,
  LibraryBig,
  Users,
  Settings,
  Search,
  LogOut,
  Menu,
  X,
  CornerDownLeft,
  Eye,
  EyeOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/BrandMark'
import { useEscClose } from '@/lib/useEscClose'
import { api, getToken, setToken, type DashboardData } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'

const nav = [
  { to: '/', label: '总览', icon: LayoutDashboard, exact: true },
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/tasks', label: '任务', icon: CheckSquare },
  { to: '/payments', label: '收款', icon: Wallet },
  { to: '/reminders', label: '到期提醒', short: '提醒', icon: BellRing },
  { to: '/ideas', label: '灵感记录', short: '灵感', icon: Lightbulb },
  { to: '/contents', label: '内容库', short: '内容', icon: LibraryBig },
  { to: '/clients', label: '客户', icon: Users },
]

// 移动端底部 Tab：灵感是高频入口放进来；客户放进抽屉
const mobileNav = nav.filter((n) => n.to !== '/clients')

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // 隐私打码：金额、日期、项目/客户名在截图时模糊掉，随时一键切换
  const [masked, setMasked] = useState(() => localStorage.getItem('wb_privacy_mask') === '1')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    document.documentElement.classList.toggle('privacy-mode', masked)
    localStorage.setItem('wb_privacy_mask', masked ? '1' : '0')
  }, [masked])

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

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // 服务端不可达时仍然退出本地登录态
    }
    setToken(null)
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen">
      {/* 桌面侧栏：固定不随内容滚动，否则长页面下「设置/退出」会被顶出视野 */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[var(--border)] bg-white lg:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm shadow-brand-500/30">
            <BrandMark className="h-5 w-5" />
          </div>
          <span className="text-sm font-bold tracking-tight text-ink-900">工作台</span>
        </div>

        {/* 导航区独立滚动：屏幕很矮时也不会把底部的设置/退出挤出去 */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
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
            <span
              className="tabular text-xs font-semibold text-amber-700"
              title="净合同额 - 已收，包含还没排收款计划的欠款"
            >
              待收 {data ? (data.finance.unreceived).toLocaleString('zh-CN') : '—'}
            </span>
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2.5 text-xs text-ink-400 transition-colors hover:border-ink-300 hover:text-ink-600 sm:w-64"
          >
            <Search size={13} className="shrink-0" />
            <span className="hidden whitespace-nowrap sm:inline">搜索项目、任务、灵感、内容…</span>
            <kbd className="ml-auto hidden rounded border border-ink-200 px-1 text-[10px] text-ink-400 sm:inline">
              /
            </kbd>
          </button>

          <button
            onClick={() => setMasked((v) => !v)}
            aria-pressed={masked}
            title={`${masked ? '关闭' : '开启'}隐私打码（Ctrl+Shift+M）`}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
              masked
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-[var(--border)] bg-white text-ink-400 hover:border-ink-300 hover:text-ink-600',
            )}
          >
            {masked ? <EyeOff size={13} /> : <Eye size={13} />}
            <span className="hidden sm:inline">{masked ? '已打码' : '打码'}</span>
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
                <span className="text-[10px] font-medium">{item.short ?? item.label}</span>
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
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white">
                  <BrandMark className="h-5 w-5" />
                </div>
                <span className="text-sm font-bold">工作台</span>
              </div>
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
      <GlobalHotkeys onSearch={() => setSearchOpen(true)} onToggleMask={() => setMasked((v) => !v)} />
    </div>
  )
}

function GlobalHotkeys({ onSearch, onToggleMask }: { onSearch: () => void; onToggleMask: () => void }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName) || el?.isContentEditable
      // 打码在任何地方都能按，包括正在输入时
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        onToggleMask()
        return
      }
      if (e.key === '/' && !typing) {
        e.preventDefault()
        onSearch()
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onSearch, onToggleMask])
  return null
}

type SearchHit = { key: string; label: string; sub?: string; to: string }

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<any>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
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

  // 分组展示，同时摊平成一维列表供键盘上下选择
  const groups = useMemo<{ title: string; hits: SearchHit[] }[]>(() => {
    if (!res) return []
    return [
      {
        title: '项目',
        hits: (res.projects ?? []).map(
          (p: any): SearchHit => ({ key: `p${p.id}`, label: p.name, sub: p.techStack, to: `/projects/${p.id}` }),
        ),
      },
      {
        title: '任务',
        hits: (res.tasks ?? []).map(
          (t: any): SearchHit => ({ key: `t${t.id}`, label: t.title, to: '/tasks' }),
        ),
      },
      {
        title: '灵感',
        hits: (res.ideas ?? []).map(
          (i: any): SearchHit => ({ key: `i${i.id}`, label: i.title, sub: i.tags, to: '/ideas' }),
        ),
      },
      {
        title: '内容',
        hits: (res.contents ?? []).map(
          (c: any): SearchHit => ({ key: `ct${c.id}`, label: c.title, sub: c.tags, to: `/contents/${c.id}` }),
        ),
      },
      {
        title: '提醒',
        hits: (res.reminders ?? []).map(
          (r: any): SearchHit => ({ key: `r${r.id}`, label: r.title, to: '/reminders' }),
        ),
      },
      {
        title: '客户',
        hits: (res.clients ?? []).map(
          (c: any): SearchHit => ({ key: `c${c.id}`, label: c.name, sub: c.contact, to: '/clients' }),
        ),
      },
    ].filter((g) => g.hits.length > 0)
  }, [res])

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])

  // 关键词变了就回到第一条
  useEffect(() => setActive(0), [q, groups.length])

  // 键盘选中项自动滚进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!flat.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = flat[active]
      if (hit) go(hit.to)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(flat.length - 1)
    }
  }

  const total = flat.length
  let cursor = -1

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
            onKeyDown={onKeyDown}
            placeholder="搜索项目、任务、灵感、内容、客户…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
          />
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X size={16} />
          </button>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {!res && (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-ink-400">输入关键词开始搜索</p>
              <p className="mt-1.5 text-[10px] text-ink-300">↑ ↓ 选择 · Enter 打开 · Esc 关闭</p>
            </div>
          )}

          {res && total === 0 && <p className="px-2 py-6 text-center text-xs text-ink-400">没有找到匹配内容</p>}

          {res &&
            groups.map((g) => (
              <div key={g.title} className="mb-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  {g.title}
                </p>
                {g.hits.map((hit) => {
                  cursor += 1
                  const idx = cursor
                  const isActive = idx === active
                  return (
                    <button
                      key={hit.key}
                      data-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(hit.to)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-50',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{hit.label}</span>
                      {hit.sub && (
                        <span className="shrink-0 truncate text-[10px] text-ink-400">{hit.sub}</span>
                      )}
                      {isActive && <CornerDownLeft size={11} className="shrink-0 text-brand-400" />}
                    </button>
                  )
                })}
              </div>
            ))}
        </div>

        {total > 0 && (
          <div className="flex items-center gap-3 border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-ink-400">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-ink-200 px-1">↑</kbd>
              <kbd className="rounded border border-ink-200 px-1">↓</kbd> 选择
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-ink-200 px-1">Enter</kbd> 打开
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-ink-200 px-1">Esc</kbd> 关闭
            </span>
            <span className="ml-auto">{total} 条结果</span>
          </div>
        )}
      </div>
    </div>
  )
}

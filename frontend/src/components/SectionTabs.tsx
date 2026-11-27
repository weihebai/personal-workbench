import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

export interface SectionTab {
  to: string
  label: string
  /** 父级页签：路径完全相等才算选中，避免 /projects 抢走 /projects/1 */
  exact?: boolean
}

/**
 * 侧栏一级入口下的页签壳。
 * 页面组件和路由地址都不变，只是在内容区上方加一行切换，
 * 这样收藏夹、分享链接、回顾页跳转过来的 ?scope&bucket 参数都还能用。
 */
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  return (
    <div>
      <nav className="mb-3 flex gap-0.5 overflow-x-auto rounded-lg border border-[var(--border)] bg-white p-0.5">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.exact}
            className={({ isActive }) =>
              cn(
                'h-7 whitespace-nowrap rounded px-2.5 text-[11px] font-medium leading-7 transition-colors',
                isActive ? 'bg-ink-100 text-ink-900' : 'text-ink-400 hover:text-ink-700',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}

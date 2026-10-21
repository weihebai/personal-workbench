import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export type MenuItem =
  | {
      type?: 'item'
      label: string
      icon?: React.ReactNode
      onClick: () => void
      danger?: boolean
      /** 右侧显示的快捷键提示 */
      hint?: string
      disabled?: boolean
    }
  | { type: 'separator' }

/**
 * 右键菜单。
 *
 * 用 portal 挂到 body：卡片在 overflow 容器里，绝对定位会被裁掉。
 * 位置做了边界收敛——右键点屏幕右下角时菜单要往回收，不能跑出视口。
 * Esc 和点击别处都关，滚动/缩放也关（否则菜单会飘在原地）。
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  // 先量出实际尺寸再定位，避免先渲染在错误位置再跳一下
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const left = Math.min(x, window.innerWidth - width - pad)
    const top = Math.min(y, window.innerHeight - height - pad)
    setPos({ left: Math.max(pad, left), top: Math.max(pad, top), ready: true })
  }, [x, y, items.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // 捕获阶段：页面里别的滚动容器也可能触发，统一关掉
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      className="fixed z-[100] min-w-[168px] rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg shadow-black/10"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.type === 'separator' ? (
          <div key={i} className="my-1 h-px bg-[var(--border)]" />
        ) : (
          <button
            key={i}
            role="menuitem"
            type="button"
            disabled={it.disabled}
            onClick={() => {
              it.onClick()
              onClose()
            }}
            className={cn(
              'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
              'disabled:pointer-events-none disabled:opacity-40',
              it.danger
                ? 'text-red-600 hover:bg-red-50'
                : 'text-ink-700 hover:bg-ink-100',
            )}
          >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-ink-400">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-[10px] text-ink-300">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

/** 右键菜单的状态管理，绑到任意元素上 */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number } | null>(null)
  const open = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState({ x: e.clientX, y: e.clientY })
  }
  return { state, open, close: () => setState(null) }
}

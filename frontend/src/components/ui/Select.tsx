import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEscClose } from '@/lib/useEscClose'

export interface Option {
  value: string
  label: string
  /** 选项前的色点（用于状态类） */
  dot?: string
  hint?: string
}

/**
 * 自定义下拉：使用 fixed 定位贴合触发元素，
 * 避免原生 select 在弹窗内被裁切/样式不一致的问题。
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = '请选择',
  className,
  disabled,
  size = 'md',
}: {
  value: string
  onChange: (v: string) => void
  options: Option[]
  placeholder?: string
  className?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = React.useState(false)
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const [activeIdx, setActiveIdx] = React.useState(-1)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const current = options.find((o) => o.value === value)

  // 下拉打开时，Esc 只关下拉，不关背后的弹窗
  useEscClose(open, () => setOpen(false))

  const place = React.useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    // 下方空间不足则向上翻转
    const need = Math.min(280, options.length * 30 + 12)
    const spaceBelow = window.innerHeight - r.bottom
    const flipUp = spaceBelow < need && r.top > need
    setRect(
      new DOMRect(
        r.left,
        flipUp ? r.top - Math.min(need, r.top - 8) - 2 : r.bottom + 2,
        r.width,
        Math.min(need, flipUp ? r.top - 8 : spaceBelow - 8),
      ),
    )
  }, [options.length])

  React.useLayoutEffect(() => {
    if (open) {
      place()
      const idx = options.findIndex((o) => o.value === value)
      setActiveIdx(idx >= 0 ? idx : 0)
    }
  }, [open, place, options, value])

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (listRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onScroll = () => place()
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, place])

  React.useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  const choose = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (options[activeIdx]) choose(options[activeIdx].value)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg border bg-white text-left transition-colors',
          'focus:outline-none focus:ring-3 focus:ring-brand-500/12',
          size === 'sm' ? 'h-8 px-2 text-xs' : 'h-9 px-2.5 text-sm',
          open ? 'border-brand-400 ring-3 ring-brand-500/12' : 'border-[var(--border)] hover:border-ink-300',
          disabled && 'cursor-not-allowed bg-ink-50 text-ink-400',
          className,
        )}
      >
        {current?.dot && <span className={cn('dot shrink-0', current.dot)} />}
        <span className={cn('flex-1 truncate', !current && 'text-ink-400')}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown
          size={13}
          className={cn('shrink-0 text-ink-400 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.top,
              width: Math.max(rect.width, 140),
              maxHeight: rect.height,
              zIndex: 9999,
            }}
            className="overflow-y-auto rounded-lg border border-[var(--border)] bg-white p-1 shadow-xl shadow-ink-900/10 animate-in"
          >
            {options.length === 0 && (
              <p className="px-2 py-2 text-center text-xs text-ink-400">暂无可选项</p>
            )}
            {options.map((o, i) => {
              const selected = o.value === value
              return (
                <button
                  key={o.value}
                  data-idx={i}
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => choose(o.value)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    i === activeIdx ? 'bg-brand-50 text-brand-700' : 'text-ink-700',
                  )}
                >
                  {o.dot && <span className={cn('dot shrink-0', o.dot)} />}
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-[10px] text-ink-400">{o.hint}</span>}
                  {selected && <Check size={12} className="shrink-0 text-brand-600" />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}

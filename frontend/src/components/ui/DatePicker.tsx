import * as React from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEscClose } from '@/lib/useEscClose'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const pad = (n: number) => String(n).padStart(2, '0')

function parse(v?: string | null): Date | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 自定义日期选择：贴合品牌样式的日历弹层，
 * 替代原生 input[type=date]（各浏览器外观不一致）。
 */
export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  className,
  size = 'md',
  clearable = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  size?: 'sm' | 'md'
  clearable?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)

  const selected = parse(value)
  // 日历面板打开时，Esc 只关面板
  useEscClose(open, () => setOpen(false))
  const [viewYear, setViewYear] = React.useState(() => (selected ?? new Date()).getFullYear())
  const [viewMonth, setViewMonth] = React.useState(() => (selected ?? new Date()).getMonth())

  const place = React.useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const panelH = 296
    const panelW = 248
    const spaceBelow = window.innerHeight - r.bottom
    const flipUp = spaceBelow < panelH && r.top > panelH
    let left = r.left
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8
    setRect(
      new DOMRect(
        Math.max(8, left),
        flipUp ? r.top - panelH - 2 : r.bottom + 2,
        panelW,
        panelH,
      ),
    )
  }, [])

  React.useLayoutEffect(() => {
    if (open) {
      const s = parse(value)
      const base = s ?? new Date()
      setViewYear(base.getFullYear())
      setViewMonth(base.getMonth())
      place()
    }
  }, [open, value, place])

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
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

  const first = new Date(viewYear, viewMonth, 1)
  const startOffset = (first.getDay() + 6) % 7 // 周一为起点
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const today = new Date()
  const isToday = (d: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d
  const isSelected = (d: number) =>
    !!selected &&
    selected.getFullYear() === viewYear &&
    selected.getMonth() === viewMonth &&
    selected.getDate() === d

  const shift = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const pick = (d: number) => {
    onChange(`${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`)
    setOpen(false)
  }

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg border bg-white text-left transition-colors',
          'focus:outline-none focus:ring-3 focus:ring-brand-500/12',
          size === 'sm' ? 'h-8 px-2 text-xs' : 'h-9 px-2.5 text-sm',
          open ? 'border-brand-400 ring-3 ring-brand-500/12' : 'border-[var(--border)] hover:border-ink-300',
          className,
        )}
      >
        <Calendar size={13} className="shrink-0 text-ink-400" />
        <span className={cn('tabular flex-1 truncate', !value && 'text-ink-400')}>
          {value || placeholder}
        </span>
        {clearable && value && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            className="shrink-0 rounded p-0.5 text-ink-300 hover:bg-ink-100 hover:text-ink-600"
          >
            <X size={11} />
          </span>
        )}
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, zIndex: 9999 }}
            className="rounded-xl border border-[var(--border)] bg-white p-2.5 shadow-xl shadow-ink-900/10 animate-in"
          >
            <div className="mb-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => shift(-12)}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                title="上一年"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                onClick={() => shift(-1)}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                title="上个月"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="tabular flex-1 text-center text-xs font-semibold text-ink-900">
                {viewYear} 年 {viewMonth + 1} 月
              </span>
              <button
                type="button"
                onClick={() => shift(1)}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                title="下个月"
              >
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => shift(12)}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                title="下一年"
              >
                <ChevronRight size={12} />
              </button>
            </div>

            <div className="mb-0.5 grid grid-cols-7">
              {WEEK.map((w) => (
                <span key={w} className="py-0.5 text-center text-[10px] font-medium text-ink-400">
                  {w}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((d, i) => {
                if (d === null) return <span key={i} />
                const sel = isSelected(d)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(d)}
                    className={cn(
                      'tabular mx-auto flex h-6 w-6 items-center justify-center rounded-md text-[11px] transition-colors',
                      sel
                        ? 'bg-brand-500 font-semibold text-white'
                        : isToday(d)
                          ? 'font-semibold text-brand-600 ring-1 ring-brand-200'
                          : 'text-ink-700 hover:bg-brand-50 hover:text-brand-700',
                    )}
                  >
                    {d}
                  </button>
                )
              })}
            </div>

            <div className="mt-1.5 flex items-center justify-between border-t border-[var(--border)] pt-1.5">
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="rounded px-1.5 py-1 text-[11px] text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                清除
              </button>
              <button
                type="button"
                onClick={() => {
                  const n = new Date()
                  setViewYear(n.getFullYear())
                  setViewMonth(n.getMonth())
                  onChange(`${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`)
                  setOpen(false)
                }}
                className="rounded px-1.5 py-1 text-[11px] font-medium text-brand-600 hover:bg-brand-50"
              >
                今天
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

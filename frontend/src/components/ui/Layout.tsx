import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEscClose } from '@/lib/useEscClose'
import { Button } from './Button'

export function Badge({
  children,
  className,
  soft,
  dot,
}: {
  children: React.ReactNode
  className?: string
  soft?: string
  dot?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
        soft ?? 'border-ink-200 bg-ink-50 text-ink-600',
        className,
      )}
    >
      {dot && <span className={cn('dot', dot)} />}
      {children}
    </span>
  )
}

export function Card({
  children,
  className,
  padding = true,
  id,
}: {
  children: React.ReactNode
  className?: string
  padding?: boolean
  id?: string
}) {
  return (
    <div id={id} className={cn('card', padding && 'p-3.5', className)}>
      {children}
    </div>
  )
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  // Esc 关闭（栈式，浮层逐层关闭）
  useEscClose(open, onClose)

  // 打开时锁定页面滚动
  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-xl animate-in',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-ink-400">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3.5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon?: React.ReactNode
  title: string
  desc?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-500">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-ink-900">{title}</p>
      {desc && <p className="max-w-xs text-xs text-ink-400">{desc}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-ink-100', className)} />
}

export function PageHeader({
  title,
  desc,
  actions,
}: {
  title: string
  desc?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold tracking-tight text-ink-900">{title}</h1>
        {desc && <p className="mt-0.5 text-xs text-ink-400">{desc}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

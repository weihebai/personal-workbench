import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm text-ink-900',
        'placeholder:text-ink-400 transition-colors',
        'focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-500/12',
        'disabled:bg-ink-50 disabled:text-ink-400',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-ink-900',
      'placeholder:text-ink-400 transition-colors resize-y min-h-[72px]',
      'focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-500/12',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-xs font-medium text-ink-500">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="text-xs text-red-500">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-400">{hint}</span>
      ) : null}
    </div>
  )
}

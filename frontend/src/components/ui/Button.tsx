import * as React from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
type Size = 'sm' | 'md' | 'icon'

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm shadow-brand-500/25',
  secondary:
    'bg-ink-100 text-ink-700 hover:bg-ink-200 border border-transparent',
  outline:
    'bg-white text-ink-700 border border-[var(--border)] hover:bg-ink-50 hover:border-ink-300',
  ghost: 'bg-transparent text-ink-500 hover:bg-ink-100 hover:text-ink-900',
  danger: 'bg-red-500 text-white hover:bg-red-600 shadow-sm shadow-red-500/25',
  success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm shadow-emerald-500/25',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-1.5 rounded-lg',
  icon: 'h-8 w-8 rounded-md',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="mr-1 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'ghost' | 'outline' | 'secondary' | 'destructive'
  size?: 'default' | 'sm' | 'icon'
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const variants = {
      default:
        'bg-accent text-fg hover:bg-accent-hover active:bg-accent-active shadow-[0_2px_8px_rgba(0,0,0,0.35)]',
      secondary: 'bg-surface-elevated text-fg hover:opacity-90',
      destructive: 'bg-status-error text-fg hover:opacity-90',
      ghost: 'bg-transparent hover:bg-surface-2/80',
      outline: 'border border-border-default bg-transparent hover:bg-surface-2/50',
    } as const
    const sizes = {
      default: 'h-9 px-3 py-1.5',
      sm: 'h-8 px-2 py-1 text-xs',
      icon: 'h-9 w-9 p-0',
    } as const
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition disabled:opacity-50',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

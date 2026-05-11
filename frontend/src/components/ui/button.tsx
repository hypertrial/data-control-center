import * as React from 'react'
import { cn } from '@/lib/utils'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'ghost' | 'outline'
  size?: 'default' | 'sm' | 'icon'
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variants = {
      default:
        'bg-[hsl(var(--accent))] text-white hover:opacity-90',
      ghost: 'bg-transparent hover:bg-white/5',
      outline: 'border border-white/15 bg-transparent hover:bg-white/5',
    } as const
    const sizes = {
      default: 'h-9 px-3 py-1.5',
      sm: 'h-8 px-2 py-1 text-xs',
      icon: 'h-9 w-9 p-0',
    } as const
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md text-sm font-medium transition disabled:opacity-50',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

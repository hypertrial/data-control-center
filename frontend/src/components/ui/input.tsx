import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  containerClassName?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, containerClassName, prefix, suffix, ...props },
  ref,
) {
  if (prefix == null && suffix == null) {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-9 w-full rounded-md border border-border-default bg-surface-1/80 px-3 py-1 text-sm text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-accent/40',
          className,
        )}
        {...props}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-md border border-border-default bg-surface-1/80 px-2 text-sm focus-within:ring-2 focus-within:ring-accent/40',
        containerClassName,
      )}
    >
      {prefix ? <span className="shrink-0 text-fg-muted [&_svg]:h-4 [&_svg]:w-4">{prefix}</span> : null}
      <input
        ref={ref}
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent py-1 text-sm text-fg outline-none placeholder:text-fg-muted',
          className,
        )}
        {...props}
      />
      {suffix ? <span className="shrink-0 text-fg-muted">{suffix}</span> : null}
    </div>
  )
})

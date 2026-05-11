import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-white/15 bg-black/30 px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]/40',
        className,
      )}
      {...props}
    />
  )
})

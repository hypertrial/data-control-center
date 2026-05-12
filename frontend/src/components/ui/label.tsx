import * as React from 'react'
import { cn } from '@/lib/utils'

export function Label({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('text-[10px] font-medium uppercase tracking-wider text-fg-muted', className)}
      {...props}
    >
      {children}
    </span>
  )
}

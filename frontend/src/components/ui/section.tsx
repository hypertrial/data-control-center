import * as React from 'react'
import { cn } from '@/lib/utils'

export function Section({
  title,
  description,
  children,
  className,
  action,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  action?: React.ReactNode
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title != null || description != null || action != null) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            {title != null && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
            {description != null && (
              <p className="max-w-3xl text-sm text-[hsl(var(--muted))]">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-6 p-4 sm:p-6', className)}>{children}</div>
}

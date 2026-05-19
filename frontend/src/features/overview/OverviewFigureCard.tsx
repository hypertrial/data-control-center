import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function FigureCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('border-border-default flex h-full min-w-0 flex-col overflow-hidden', className)}>
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-sm font-semibold leading-tight">{title}</CardTitle>
        {description ? (
          <p className="text-xs leading-snug text-[hsl(var(--muted))]">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-0">{children}</CardContent>
    </Card>
  )
}

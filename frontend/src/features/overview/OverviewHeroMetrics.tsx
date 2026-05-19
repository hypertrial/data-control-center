import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { qualityScoreSeverity } from '@/lib/tokens'
import { cn } from '@/lib/utils'

export function HeroMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
}) {
  return (
    <Card className="border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums text-white">{value}</div>
        {hint != null && <div className="text-xs text-[hsl(var(--muted))]">{hint}</div>}
      </CardContent>
    </Card>
  )
}

export function QualityHero({
  score,
  trend,
}: {
  score: number | null | undefined
  trend?: number | null
}) {
  if (score == null) {
    return <HeroMetric label="Quality score" value="—" hint="Run refresh after first profile" />
  }
  const sev = qualityScoreSeverity(score)
  const pct = Math.min(100, Math.max(0, score))
  const bar =
    sev === 'critical'
      ? 'bg-[hsl(var(--severity-critical))]'
      : sev === 'warning'
        ? 'bg-[hsl(var(--severity-warning))]'
        : 'bg-[hsl(var(--severity-ok))]'
  return (
    <Card className="border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
          Quality score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-semibold">{score}</span>
          <span className="text-sm text-[hsl(var(--muted))]">/100</span>
          {trend != null && Number.isFinite(trend) && Math.abs(trend) >= 0.05 ? (
            <span
              className={cn(
                'text-xs font-medium',
                trend > 0 ? 'text-[hsl(var(--severity-ok))]' : 'text-[hsl(var(--severity-critical))]',
              )}
              title="Change vs previous profile snapshot"
            >
              {trend > 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}
            </span>
          ) : null}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
        </div>
      </CardContent>
    </Card>
  )
}

import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { qualityScoreSeverity, type SeverityKey } from '@/lib/tokens'
import { cn } from '@/lib/utils'

function severityBarClass(sev: SeverityKey): string {
  if (sev === 'critical') return 'bg-[hsl(var(--severity-critical))]'
  if (sev === 'warning') return 'bg-[hsl(var(--severity-warning))]'
  return 'bg-[hsl(var(--severity-ok))]'
}

function severityTextClass(sev: SeverityKey): string {
  if (sev === 'critical') return 'text-[hsl(var(--severity-critical))]'
  if (sev === 'warning') return 'text-[hsl(var(--severity-warning))]'
  return 'text-[hsl(var(--severity-ok))]'
}

function severityLabel(sev: SeverityKey): string {
  if (sev === 'ok') return 'Healthy'
  return sev
}

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
        <CardTitle className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--fg-muted))]">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums text-white">{value}</div>
        {hint != null && <div className="text-xs text-[hsl(var(--fg-muted))]">{hint}</div>}
      </CardContent>
    </Card>
  )
}

/** Inline score + bar for section headers (e.g. Quality page overview). */
export function QualityScoreSummary({
  score,
  className,
}: {
  score: number | null | undefined
  className?: string
}) {
  if (score == null) {
    return <span className={cn('tabular-nums text-2xl font-semibold', className)}>—</span>
  }
  const sev = qualityScoreSeverity(score)
  const pct = Math.min(100, Math.max(0, score))
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-baseline gap-2 tabular-nums">
        <span className="text-2xl font-semibold">{score}</span>
        <span className="text-sm text-[hsl(var(--fg-muted))]">/100</span>
        <span
          className={cn(
            'text-[10px] font-medium uppercase tracking-wider',
            severityTextClass(sev),
          )}
        >
          {severityLabel(sev)}
        </span>
      </div>
      <div className="h-2.5 max-w-xs overflow-hidden rounded-full bg-white/10">
        <div
          className={cn('h-full rounded-full transition-all', severityBarClass(sev))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function ColumnTypeHint({
  numeric,
  categorical,
  datetime,
}: {
  numeric: number
  categorical: number
  datetime: number
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1" title="Numeric">
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" aria-hidden />
        {numeric} num
      </span>
      <span className="text-white/20">·</span>
      <span className="inline-flex items-center gap-1" title="Categorical">
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent-orange))]" aria-hidden />
        {categorical} cat
      </span>
      <span className="text-white/20">·</span>
      <span className="inline-flex items-center gap-1" title="Datetime">
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent-cyan))]" aria-hidden />
        {datetime} dt
      </span>
    </span>
  )
}

export function QualityHero({
  score,
  trend,
  hasHistoryTrend = true,
}: {
  score: number | null | undefined
  trend?: number | null
  hasHistoryTrend?: boolean
}) {
  if (score == null) {
    return <HeroMetric label="Quality score" value="—" hint="Run refresh after first profile" />
  }
  const sev = qualityScoreSeverity(score)
  const pct = Math.min(100, Math.max(0, score))
  const bar = severityBarClass(sev)
  return (
    <Card className="border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--fg-muted))]">
          Quality score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-semibold">{score}</span>
          <span className="text-sm text-[hsl(var(--fg-muted))]">/100</span>
          <span
            className={cn(
              'text-[10px] font-medium uppercase tracking-wider',
              severityTextClass(sev),
            )}
          >
            {severityLabel(sev)}
          </span>
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
          ) : !hasHistoryTrend ? (
            <span className="text-xs text-[hsl(var(--fg-muted))]">No prior snapshot</span>
          ) : null}
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
        </div>
      </CardContent>
    </Card>
  )
}

import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CompletenessBars } from '@/features/overview/CompletenessBars'
import { MissingnessMiniChart } from '@/features/overview/MissingnessMiniChart'
import type { CompletenessStats } from '@/features/overview/completenessStats'
import { formatCount, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MetricScope } from '@/api/types'

export function CompletenessPanel({
  stats,
  missingPct,
  duplicatePct,
  duplicateScope,
  metricWarnings,
  topNullNames,
  topNullValues,
  qualitySearch,
  onColumnClick,
  onViewFlaggedColumns,
}: {
  stats: CompletenessStats
  missingPct: number | null
  duplicatePct: number | null
  duplicateScope?: MetricScope | null
  metricWarnings: string[]
  topNullNames: string[]
  topNullValues: number[]
  qualitySearch: string
  onColumnClick: (columnName: string) => void
  onViewFlaggedColumns: () => void
}) {
  const chips = [
    stats.colsWithNulls > 0
      ? { label: `${stats.colsWithNulls} cols with nulls`, key: 'with-nulls' }
      : null,
    stats.colsHighNull > 0
      ? { label: `${stats.colsHighNull} ≥20% null`, key: 'high-null' }
      : null,
    stats.colsFullyNull > 0
      ? { label: `${stats.colsFullyNull} fully null`, key: 'fully-null' }
      : null,
  ].filter(Boolean) as { label: string; key: string }[]

  const populatedSeverityClass =
    stats.missingSeverity === 'critical'
      ? 'text-[hsl(var(--severity-critical))]'
      : stats.missingSeverity === 'warning'
        ? 'text-[hsl(var(--severity-warning))]'
        : 'text-white'

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cn('text-2xl font-semibold tabular-nums', populatedSeverityClass)}>
            {stats.populatedPct != null ? formatPercent(stats.populatedPct) : '—'}
          </span>
          <span className="text-sm text-[hsl(var(--fg-muted))]">cells populated</span>
          {stats.missingPct != null ? (
            <span className="text-xs text-[hsl(var(--fg-muted))]">
              · {formatPercent(stats.missingPct)} missing
            </span>
          ) : null}
        </div>
        {(stats.estimatedMissingCells != null || stats.estimatedDuplicateRows != null) && (
          <p className="mt-1 text-xs text-[hsl(var(--fg-muted))]">
            {stats.estimatedMissingCells != null ? (
              <span>~{formatCount(stats.estimatedMissingCells)} missing cells</span>
            ) : null}
            {stats.estimatedMissingCells != null && stats.estimatedDuplicateRows != null ? (
              <span> · </span>
            ) : null}
            {stats.estimatedDuplicateRows != null ? (
              <span>~{formatCount(stats.estimatedDuplicateRows)} duplicate rows</span>
            ) : null}
          </p>
        )}
      </div>

      {stats.isSampleProfile && stats.sampleLabel ? (
        <p className="rounded-md border border-border-default bg-white/[0.03] px-2 py-1.5 text-xs text-[hsl(var(--fg-muted))]">
          {stats.sampleLabel}
        </p>
      ) : null}

      {metricWarnings.length > 0 ? (
        <div className="rounded-md border border-[hsl(var(--severity-warning)/0.35)] bg-[hsl(var(--severity-warning)/0.08)] px-2 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--severity-warning))]">
            Profiler notes
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-white/85">
            {metricWarnings.slice(0, 2).map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="rounded-full border border-border-default bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-white/90"
            >
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}

      <CompletenessBars
        missingPct={missingPct}
        duplicatePct={duplicatePct}
        duplicateScope={duplicateScope}
        missingIsSample={stats.isSampleProfile}
      />

      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--fg-muted))]">
          Top null columns
        </div>
        <MissingnessMiniChart
          names={topNullNames}
          values={topNullValues}
          className="h-36"
          onColumnClick={onColumnClick}
        />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border-default pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onViewFlaggedColumns}>
          View flagged columns
        </Button>
        <Link
          to={{ pathname: '/quality', search: qualitySearch }}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border-default bg-transparent px-3 text-xs font-medium hover:bg-white/5"
        >
          All quality issues
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

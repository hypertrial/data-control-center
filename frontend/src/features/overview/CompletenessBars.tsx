import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MetricScope } from '@/api/types'

export function CompletenessBars({
  missingPct,
  duplicatePct,
  duplicateScope,
  missingIsSample = false,
}: {
  missingPct: number | null
  duplicatePct: number | null
  duplicateScope?: MetricScope | null
  missingIsSample?: boolean
}) {
  const missing = missingPct != null ? Math.min(100, Math.max(0, missingPct)) : null
  const duplicate = duplicatePct != null ? Math.min(100, Math.max(0, duplicatePct)) : null

  return (
    <div className="flex flex-col gap-4 px-1">
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-[hsl(var(--fg-muted))]">
            {missingIsSample ? 'Missing cells (sample)' : 'Missing cells'}
          </span>
          <span className="tabular-nums text-sm font-semibold text-white">
            {missing != null ? formatPercent(missing) : '—'}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              missing != null && missing > 20
                ? 'bg-[hsl(var(--severity-warning))]'
                : 'bg-[hsl(var(--severity-info))]',
            )}
            style={{ width: `${missing ?? 0}%` }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-[hsl(var(--fg-muted))]">
            {duplicateScope === 'sample' ? 'Duplicate rows (sample)' : 'Duplicate rows'}
          </span>
          <span className="tabular-nums text-sm font-semibold text-white">
            {duplicate != null ? formatPercent(duplicate) : '—'}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              duplicate != null && duplicate > 5
                ? 'bg-[hsl(var(--severity-warning))]'
                : 'bg-[hsl(var(--severity-ok))]',
            )}
            style={{ width: `${duplicate ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  )
}

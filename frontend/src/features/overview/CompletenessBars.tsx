import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

export function CompletenessBars({
  missingPct,
  duplicatePct,
}: {
  missingPct: number | null
  duplicatePct: number | null
}) {
  const missing = missingPct != null ? Math.min(100, Math.max(0, missingPct)) : null
  const duplicate = duplicatePct != null ? Math.min(100, Math.max(0, duplicatePct)) : null

  return (
    <div className="flex min-h-[14rem] flex-col justify-center gap-6 px-1 py-2">
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-[hsl(var(--muted))]">Missing cells</span>
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
          <span className="text-xs font-medium text-[hsl(var(--muted))]">Duplicate rows (sample)</span>
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

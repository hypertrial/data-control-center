import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatBytes, formatCount, formatDatasetFormat, formatRelativeTime } from '@/lib/format'
import { qualityScoreSeverity } from '@/lib/tokens'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'

function QualityBar({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-sm text-[hsl(var(--muted))]">—</span>
  const sev = qualityScoreSeverity(score)
  const pct = Math.min(100, Math.max(0, score))
  const color =
    sev === 'critical'
      ? 'bg-[hsl(var(--severity-critical))]'
      : sev === 'warning'
        ? 'bg-[hsl(var(--severity-warning))]'
        : 'bg-[hsl(var(--severity-ok))]'
  return (
    <div className="flex min-w-[140px] flex-col gap-1">
      <div className="flex items-baseline gap-1 tabular-nums">
        <span className="text-lg font-semibold">{score}</span>
        <span className="text-xs text-[hsl(var(--muted))]">/100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function DatasetContextStrip() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const qc = useQueryClient()
  const [refreshBusy, setRefreshBusy] = useState(false)

  const dsQ = useQuery({
    queryKey: ['datasets'],
    queryFn: api.listDatasets,
  })

  const profileQ = useQuery({
    queryKey: ['profile', activeId],
    queryFn: () => api.getProfile(activeId!),
    enabled: !!activeId,
  })

  const summary = (dsQ.data ?? []).find((d) => d.dataset_id === activeId)

  if (!activeId) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[hsl(var(--card))]/40 px-4 py-2 text-xs text-[hsl(var(--muted))]">
        Select a dataset from the sidebar to load context.
      </div>
    )
  }

  const name = summary?.name ?? profileQ.data?.name ?? activeId
  const rows = profileQ.data?.rows ?? summary?.row_count ?? null
  const cols = profileQ.data?.columns ?? summary?.column_count ?? null
  const sizeBytes = profileQ.data?.file_size_bytes ?? summary?.file_size_bytes ?? null
  const format = summary?.format ?? '—'
  const qScore = profileQ.data?.quality_score ?? summary?.quality_score ?? null
  const updated = profileQ.dataUpdatedAt

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 bg-[hsl(var(--card))]/50 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-tight" title={name}>
          {name}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
          <span className="tabular-nums">{formatCount(rows)} rows</span>
          <span className="text-white/20">·</span>
          <span className="tabular-nums">{formatCount(cols)} cols</span>
          <span className="text-white/20">·</span>
          <span className="tabular-nums">{formatBytes(sizeBytes)}</span>
          <span className="text-white/20">·</span>
          <Badge variant="default" className="font-normal">
            {formatDatasetFormat(format)}
          </Badge>
          {updated ? (
            <>
              <span className="text-white/20">·</span>
              <span>Profiled {formatRelativeTime(updated)}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Quality
          </div>
          <QualityBar score={qScore} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1"
          onClick={() => {
            setRefreshBusy(true)
            void api
              .refreshProfile(activeId)
              .then(() => {
                void qc.invalidateQueries({ queryKey: ['datasets'] })
                void qc.invalidateQueries({ queryKey: ['profile', activeId] })
                void qc.invalidateQueries({ queryKey: ['quality', activeId] })
              })
              .finally(() => setRefreshBusy(false))
          }}
          disabled={profileQ.isFetching || refreshBusy}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (profileQ.isFetching || refreshBusy) && 'animate-spin')} />
          Refresh
        </Button>
      </div>
    </div>
  )
}

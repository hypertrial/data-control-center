import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useUiStore } from '@/store/uiStore'

function formatBytes(n: number | null | undefined) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function narrativeToText(md: string) {
  return md.replace(/\*\*(.*?)\*\*/g, '$1')
}

export function OverviewPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const q = useQuery({
    queryKey: ['profile', activeId],
    queryFn: () => api.getProfile(activeId!),
    enabled: !!activeId,
  })

  if (!activeId) {
    return (
      <div className="p-6 text-[hsl(var(--muted))]">Select or register a dataset to begin.</div>
    )
  }

  if (q.isLoading) return <div className="p-6">Loading profile…</div>
  if (q.isError)
    return <div className="p-6 text-red-300">{(q.error as Error).message}</div>

  const p = q.data!

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">{p.name}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">{p.dataset_id}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[hsl(var(--muted))]">Rows</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{p.rows.toLocaleString()}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[hsl(var(--muted))]">Columns</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{p.columns}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[hsl(var(--muted))]">File size</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatBytes(p.file_size_bytes)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[hsl(var(--muted))]">Quality score</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {p.quality_score != null ? `${p.quality_score}` : '—'}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dataset readout</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-[hsl(var(--foreground))]/90">
          <p className="whitespace-pre-wrap">{narrativeToText(p.narrative)}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge>Missing cells {p.missing_cell_pct != null ? `${p.missing_cell_pct}%` : '—'}</Badge>
            <Badge>
              Duplicate rows (sample) {p.duplicate_row_pct != null ? `${p.duplicate_row_pct}%` : '—'}
            </Badge>
            <Badge>Numeric cols {p.numeric_column_count}</Badge>
            <Badge>Category cols {p.categorical_column_count}</Badge>
            <Badge>Datetime cols {p.datetime_column_count}</Badge>
          </div>
          {p.likely_grain && <p className="text-[hsl(var(--muted))]">Grain: {p.likely_grain}</p>}
          {p.primary_date_column && (
            <p className="text-[hsl(var(--muted))]">Primary date: {p.primary_date_column}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

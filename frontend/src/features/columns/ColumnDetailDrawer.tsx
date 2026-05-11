import { useRef, useState } from 'react'
import type { ColumnProfile } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { formatPercent } from '@/lib/format'
import { sqlSelectColumnFromView, sqlSelectStarFromView } from '@/lib/sql'

const FLAG_HELP: Record<string, string> = {
  high_missingness: 'A large share of values are null; joins and aggregates may be biased.',
  id_with_nulls: 'This identifier column contains nulls; uniqueness and join keys may be unreliable.',
  constant_column: 'All sampled values are the same; the column adds no information in this slice.',
}

function SqlSnippet({ label, sql }: { label: string; sql: string }) {
  const open = useOpenInSql()
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
      <div className="mb-1 text-[hsl(var(--muted))]">{label}</div>
      <pre className="mb-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-white/90">
        {sql}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(sql)}>
          Copy
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => open(sql)}>
          Open in SQL
        </Button>
      </div>
    </div>
  )
}

export function ColumnDetailDrawer({
  open,
  onOpenChange,
  column,
  datasetId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  column: ColumnProfile | null
  datasetId: string | null
}) {
  const [tab, setTab] = useState('distribution')
  const topRef = useRef<HTMLDivElement>(null)
  const histRef = useRef<HTMLDivElement>(null)

  const distActive = open && !!column && tab === 'distribution'
  const hist = column?.histogram ?? []
  const hasHist = hist.length > 0

  useDisposableEChart(
    histRef,
    distActive && hasHist,
    () => ({
      grid: { left: 12, right: 12, top: 24, bottom: 24, containLabel: true },
      xAxis: { type: 'category', data: hist.map((x) => x.bin), axisLabel: { rotate: 35 } },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: hist.map((x) => x.count) }],
      tooltip: { trigger: 'axis' },
    }),
    [column, hist],
  )

  useDisposableEChart(
    topRef,
    distActive && !hasHist && !!column,
    () => {
      const data =
        column!.top_values.map((t) => ({
          name: String(t.value ?? '∅'),
          value: t.count,
        }))
      return {
        grid: { left: 12, right: 12, top: 24, bottom: 24, containLabel: true },
        xAxis: { type: 'category', data: data.map((d) => d.name), axisLabel: { rotate: 35 } },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: data.map((d) => d.value) }],
        tooltip: { trigger: 'axis' },
      }
    },
    [column],
  )

  if (!column) return null

  const effectiveId = datasetId ?? 'dataset'
  const selectOne = sqlSelectColumnFromView(effectiveId, column.name, 100)
  const selectStar = sqlSelectStarFromView(effectiveId, 50)

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={column.name}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-2 w-full justify-start overflow-x-auto">
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="use">Use</TabsTrigger>
        </TabsList>

        <TabsContent value="distribution" className="mt-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge>{column.physical_type}</Badge>
            <Badge variant="info">{column.semantic_type}</Badge>
          </div>
          {column.histogram?.length ? (
            <div>
              <div className="mb-2 text-xs font-medium text-[hsl(var(--muted))]">Histogram</div>
              <div ref={histRef} className="h-56 w-full" />
            </div>
          ) : (
            <div>
              <div className="mb-2 text-xs font-medium text-[hsl(var(--muted))]">Top values</div>
              <div ref={topRef} className="h-56 w-full" />
            </div>
          )}
        </TabsContent>

        <TabsContent value="stats" className="mt-0">
          <div className="grid grid-cols-2 gap-2 text-xs text-[hsl(var(--muted))]">
            <div>Null %</div>
            <div className="text-white tabular-nums">{formatPercent(column.null_pct)}</div>
            <div>Unique (sample)</div>
            <div className="text-white tabular-nums">{column.unique_count ?? '—'}</div>
            <div>Cardinality</div>
            <div className="text-white tabular-nums">{column.cardinality ?? '—'}</div>
            <div>Min</div>
            <div className="text-white">{column.min_value ?? '—'}</div>
            <div>Max</div>
            <div className="text-white">{column.max_value ?? '—'}</div>
          </div>
        </TabsContent>

        <TabsContent value="quality" className="mt-0 space-y-3 text-sm">
          {column.quality_flags.length === 0 ? (
            <p className="text-[hsl(var(--muted))]">No quality flags on this column.</p>
          ) : (
            <ul className="space-y-2">
              {column.quality_flags.map((f) => (
                <li key={f} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="font-mono text-xs text-amber-100">{f}</div>
                  <p className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {FLAG_HELP[f] ?? 'See profiler output for details.'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="use" className="mt-0 space-y-3">
          <SqlSnippet label="Single column" sql={selectOne} />
          <SqlSnippet label="Full sample" sql={selectStar} />
        </TabsContent>
      </Tabs>
    </Sheet>
  )
}

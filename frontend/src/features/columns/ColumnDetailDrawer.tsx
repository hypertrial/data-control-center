import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { ColumnProfile } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Sheet } from '@/components/ui/sheet'

export function ColumnDetailDrawer({
  open,
  onOpenChange,
  column,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  column: ColumnProfile | null
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !column || !ref.current) return
    const chart = echarts.init(ref.current)
    const data = column.top_values.map((t) => ({
      name: String(t.value ?? '∅'),
      value: t.count,
    }))
    chart.setOption({
      grid: { left: 12, right: 12, top: 24, bottom: 24, containLabel: true },
      xAxis: { type: 'category', data: data.map((d) => d.name), axisLabel: { rotate: 35 } },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: data.map((d) => d.value) }],
      tooltip: { trigger: 'axis' },
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [open, column])

  if (!column) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={column.name}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge>{column.physical_type}</Badge>
          <Badge>{column.semantic_type}</Badge>
          {column.quality_flags.map((f) => (
            <Badge key={f} variant="warning">
              {f}
            </Badge>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-[hsl(var(--muted))]">
          <div>Null %</div>
          <div className="text-white">{column.null_pct}</div>
          <div>Unique (sample)</div>
          <div className="text-white">{column.unique_count ?? '—'}</div>
          <div>Cardinality (sample)</div>
          <div className="text-white">{column.cardinality ?? '—'}</div>
          <div>Min</div>
          <div className="text-white">{column.min_value ?? '—'}</div>
          <div>Max</div>
          <div className="text-white">{column.max_value ?? '—'}</div>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-[hsl(var(--muted))]">Top values</div>
          <div ref={ref} className="h-56 w-full" />
        </div>
      </div>
    </Sheet>
  )
}

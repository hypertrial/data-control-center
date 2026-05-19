import { useMemo, useRef } from 'react'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { hslFromRootVar, chartAxisLabelStyle, chartTooltip } from '@/lib/chartTheme'
import { estimateChartYAxisGutterPx, shortenChartLabel } from '@/features/overview/overviewChartUtils'
import { cn } from '@/lib/utils'

export function MissingnessMiniChart({
  names,
  values,
  className,
  onColumnClick,
}: {
  names: string[]
  values: number[]
  className?: string
  onColumnClick?: (columnName: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const leftGutter = useMemo(() => estimateChartYAxisGutterPx(names), [names])

  useDisposableEChart(
    ref,
    names.length > 0,
    () => {
      const crit = hslFromRootVar('--severity-critical')
      const warn = hslFromRootVar('--severity-warning')
      const info = hslFromRootVar('--severity-info')
      return {
        grid: {
          left: leftGutter,
          right: 20,
          top: 16,
          bottom: 8,
          containLabel: false,
        },
        xAxis: {
          type: 'value',
          max: 100,
          axisLabel: { formatter: '{value}%', ...chartAxisLabelStyle() },
        },
        yAxis: {
          type: 'category',
          data: names,
          inverse: true,
          axisLabel: {
            ...chartAxisLabelStyle(),
            interval: 0,
            width: Math.max(96, leftGutter - 20),
            overflow: 'truncate',
            formatter: (v: string) => shortenChartLabel(v, 44),
          },
        },
        series: [
          {
            type: 'bar',
            data: values,
            itemStyle: {
              color: (params: { data: number }) =>
                params.data > 50 ? crit : params.data > 20 ? warn : info,
            },
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (raw: unknown) => {
            const arr = raw as { dataIndex?: number; name?: string }[]
            const row = arr[0]
            const ix = typeof row?.dataIndex === 'number' ? row.dataIndex : -1
            const col = ix >= 0 ? names[ix] : row?.name ?? ''
            const pct = ix >= 0 ? values[ix] : null
            const pctStr = pct != null ? `${pct.toFixed(2)}% null` : ''
            return col ? `${col}<br/><span style="opacity:.85">${pctStr}</span>` : pctStr
          },
          ...chartTooltip(),
        },
      }
    },
    [names, values, leftGutter],
    onColumnClick
      ? (chart) => {
          const onClick = (p: { dataIndex?: number }) => {
            const ix = typeof p.dataIndex === 'number' ? p.dataIndex : -1
            const col = ix >= 0 ? names[ix] : undefined
            if (col) onColumnClick(col)
          }
          chart.on('click', onClick)
          return () => chart.off('click', onClick)
        }
      : undefined,
  )

  if (!names.length) return <p className="text-sm text-[hsl(var(--fg-muted))]">No column stats.</p>

  return (
    <div>
      {onColumnClick ? (
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--fg-muted))]">
          Click a bar to open the column
        </p>
      ) : null}
      <div
        ref={ref}
        className={cn('w-full', className ?? 'h-64')}
        role="img"
        aria-label="Top columns by null percent"
      />
    </div>
  )
}

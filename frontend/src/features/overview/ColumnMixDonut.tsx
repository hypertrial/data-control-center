import { useMemo, useRef } from 'react'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { hslFromRootVar, chartTooltip } from '@/lib/chartTheme'

const SLICE_COLORS: Record<string, string> = {
  Numeric: '--accent',
  Categorical: '--accent-orange',
  Datetime: '--accent-cyan',
  Other: '--fg-muted',
}

export function ColumnMixDonut({
  numeric,
  categorical,
  datetime,
  totalColumns,
}: {
  numeric: number
  categorical: number
  datetime: number
  totalColumns: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const other = Math.max(0, totalColumns - numeric - categorical - datetime)
  const seriesData = useMemo(
    () =>
      [
        { name: 'Numeric', value: numeric },
        { name: 'Categorical', value: categorical },
        { name: 'Datetime', value: datetime },
        ...(other > 0 ? [{ name: 'Other', value: other }] : []),
      ]
        .filter((d) => d.value > 0)
        .map((d) => {
          const token = SLICE_COLORS[d.name] ?? '--fg-muted'
          const alpha = d.name === 'Other' ? 0.55 : undefined
          return {
            ...d,
            itemStyle: { color: hslFromRootVar(token, alpha) },
          }
        }),
    [numeric, categorical, datetime, other],
  )

  useDisposableEChart(
    ref,
    totalColumns > 0,
    () => ({
      tooltip: { trigger: 'item' as const, valueFormatter: (v: number) => `${v} cols`, ...chartTooltip() },
      legend: {
        orient: 'horizontal' as const,
        bottom: 0,
        textStyle: { color: hslFromRootVar('--fg-muted'), fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['45%', '72%'],
          center: ['50%', '46%'],
          avoidLabelOverlap: true,
          label: {
            show: true,
            formatter: '{b}\n{c}',
            fontSize: 10,
            color: hslFromRootVar('--fg'),
          },
          data: seriesData.length
            ? seriesData
            : [{ name: 'No columns', value: 1, itemStyle: { color: hslFromRootVar('--fg-muted', 0.28) } }],
        },
      ],
    }),
    [seriesData],
  )

  if (totalColumns === 0) {
    return <p className="text-sm text-[hsl(var(--fg-muted))]">No column metadata.</p>
  }

  return (
    <div
      ref={ref}
      className="h-56 w-full sm:h-64"
      role="img"
      aria-label="Column types: numeric, categorical, datetime, and other counts"
    />
  )
}


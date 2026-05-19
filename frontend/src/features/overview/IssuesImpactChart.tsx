import { useMemo, useRef } from 'react'
import type { QualityIssue } from '@/api/types'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { hslFromRootVar, chartAxisLabelStyle, chartTooltip } from '@/lib/chartTheme'
import { estimateChartYAxisGutterPx, shortenChartLabel } from '@/features/overview/overviewChartUtils'

export function IssuesImpactChart({
  issues,
  openCol,
}: {
  issues: QualityIssue[]
  openCol: (c: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const labels = useMemo(() => issues.map((i) => i.title), [issues])
  const leftGutter = useMemo(() => estimateChartYAxisGutterPx(labels, 340), [labels])

  useDisposableEChart(
    ref,
    issues.length > 0,
    () => {
      const maxImpact = Math.max(1, ...issues.map((i) => i.score_impact))

      const crit = hslFromRootVar('--severity-critical')
      const warn = hslFromRootVar('--severity-warning')
      const info = hslFromRootVar('--severity-info')
      const sevColor = (s: string) => (s === 'critical' ? crit : s === 'warning' ? warn : info)

      return {
        grid: {
          left: leftGutter,
          right: 28,
          top: 16,
          bottom: 8,
          containLabel: false,
        },
        xAxis: {
          type: 'value',
          max: maxImpact * 1.08,
          splitLine: { lineStyle: { opacity: 0.2 } },
          axisLabel: { ...chartAxisLabelStyle() },
        },
        yAxis: {
          type: 'category',
          data: labels,
          inverse: true,
          axisLabel: {
            ...chartAxisLabelStyle(),
            interval: 0,
            width: Math.max(120, leftGutter - 24),
            overflow: 'truncate',
            formatter: (v: string) => shortenChartLabel(v, 52),
          },
        },
        series: [
          {
            type: 'bar',
            data: issues.map((i) => ({
              value: i.score_impact,
              itemStyle: { color: sevColor(i.severity) },
            })),
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (raw: unknown) => {
            const arr = raw as { dataIndex: number }[]
            const row = arr[0]
            if (!row || typeof row.dataIndex !== 'number') return ''
            const issue = issues[row.dataIndex]
            if (!issue) return ''
            const cols = issue.affected_columns.slice(0, 4).join(', ') || '—'
            return `${issue.title}<br/><span style="opacity:.85">Impact</span>: ${issue.score_impact.toFixed(1)}<br/><span style="opacity:.85">Columns</span>: ${cols}`
          },
          ...chartTooltip(),
        },
      }
    },
    [issues, labels, leftGutter],
    (chart) => {
      const onClick = (p: { dataIndex?: number }) => {
        const idx = typeof p.dataIndex === 'number' ? p.dataIndex : -1
        const issue = idx >= 0 ? issues[idx] : undefined
        const col = issue?.affected_columns[0]
        if (col) openCol(col)
      }
      chart.on('click', onClick)
      return () => chart.off('click', onClick)
    },
  )

  if (!issues.length) {
    return <p className="text-sm text-[hsl(var(--muted))]">No quality issues detected.</p>
  }

  return (
    <div>
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
        Click a bar to open the first affected column
      </p>
      <div
        ref={ref}
        className="h-72 w-full min-h-[16rem]"
        role="img"
        aria-label="Quality issues by score impact"
      />
    </div>
  )
}

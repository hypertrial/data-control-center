import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { formatCount } from '@/lib/format'
import { CHART_MAX_ROWS } from '@/features/charts/chartUtils'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'

type Props = Pick<
  ChartWorkspaceState,
  | 'validation'
  | 'runError'
  | 'runChart'
  | 'chartData'
  | 'chartRef'
  | 'execute'
  | 'settingsChanged'
>

export function ChartPreview({
  validation,
  runError,
  runChart,
  chartData,
  chartRef,
  execute,
  settingsChanged,
}: Props) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border-default bg-black/20">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-3 py-2">
        <div className="text-sm font-medium text-fg">Preview</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {settingsChanged ? <span className="text-[hsl(var(--severity-warning))]">Settings changed - rerunning…</span> : null}
          {runChart.data?.truncated ? (
            <span className="rounded-full border border-border-default bg-black/30 px-2 py-0.5">
              Truncated at {formatCount(CHART_MAX_ROWS)} rows
            </span>
          ) : null}
          {runChart.data && !runChart.data.error ? (
            <span className="tabular-nums">{formatCount(runChart.data.row_count)} rows</span>
          ) : null}
        </div>
      </div>

      {!validation.valid ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted">
          {validation.reason}
        </div>
      ) : runError ? (
        <div className="p-4">
          <QueryErrorBanner message={runError} onRetry={execute} />
        </div>
      ) : runChart.isPending ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-fg-muted">
          Running chart query…
        </div>
      ) : !runChart.data ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-fg-muted">
          Preparing chart query…
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted">
          The chart query returned no plottable rows.
        </div>
      ) : (
        <div ref={chartRef} className="min-h-[24rem] flex-1" data-testid="charts-preview" />
      )}
    </section>
  )
}

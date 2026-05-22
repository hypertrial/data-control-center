import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, RotateCcw, Terminal } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { PageContainer } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { ChartDataControls } from '@/features/charts/ChartDataControls'
import { ChartDisplayControls } from '@/features/charts/ChartDisplayControls'
import { ChartExportControls } from '@/features/charts/ChartExportControls'
import { ChartFilterControls } from '@/features/charts/ChartFilterControls'
import { ChartPreview } from '@/features/charts/ChartPreview'
import { ChartScaleControls, ChartSplitControls } from '@/features/charts/ChartScaleControls'
import { ChartTypeControls } from '@/features/charts/ChartTypeControls'
import { useChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import { useUiStore } from '@/store/uiStore'

function ChartsWorkspace({
  activeId,
  profile,
  viewName,
}: {
  activeId: string
  profile: import('@/api/types').DatasetProfile
  viewName: string | undefined
}) {
  const ws = useChartWorkspaceState(activeId, profile, viewName)

  return (
    <PageContainer className="flex h-full min-h-[calc(100vh-9rem)] flex-col gap-3 overflow-hidden p-4 space-y-0">
      <div className="flex flex-none flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <BarChart3 className="h-4 w-4 text-fg-muted" aria-hidden />
            Charts
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Build live histograms, bar charts, scatter plots, and line charts from the active dataset.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={ws.resetWorkspace}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </Button>
          <Tooltip content="Open generated SQL in the SQL tab">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={!ws.generatedSql}
              onClick={() => ws.openInSql(ws.generatedSql)}
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden />
              SQL
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[22rem_minmax(0,1fr)] 2xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden rounded-lg border border-border-default bg-black/20 p-2.5">
          <div className="grid max-h-full gap-2 overflow-y-auto pr-1">
            <ChartTypeControls {...ws} />
            <ChartDataControls {...ws} />
            <ChartFilterControls {...ws} />
            <ChartSplitControls {...ws} />
            <ChartScaleControls spec={ws.spec} patchSpec={ws.patchSpec} />
            <ChartDisplayControls spec={ws.spec} patchSpec={ws.patchSpec} />
            <ChartExportControls {...ws} />
          </div>
        </aside>
        <ChartPreview {...ws} />
      </div>
    </PageContainer>
  )
}

export function ChartsPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const dsQ = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const profileQ = useQuery({
    queryKey: ['profile', activeId],
    queryFn: ({ signal }) => api.fetchDatasetProfile(activeId!, { signal }),
    enabled: !!activeId,
  })

  const activeSummary = useMemo(
    () => dsQ.data?.find((d) => d.dataset_id === activeId),
    [dsQ.data, activeId],
  )

  if (!activeId) {
    return (
      <PageContainer>
        <p className="text-sm text-fg-muted">Select a dataset.</p>
      </PageContainer>
    )
  }

  if (dsQ.isLoading || profileQ.isLoading) {
    return (
      <PageContainer>
        <CardSkeleton />
        <CardSkeleton />
      </PageContainer>
    )
  }

  if (dsQ.isError) {
    return (
      <PageContainer>
        <QueryErrorBanner message={(dsQ.error as Error).message} onRetry={() => void dsQ.refetch()} />
      </PageContainer>
    )
  }

  if (profileQ.isError) {
    return (
      <PageContainer>
        <QueryErrorBanner message={(profileQ.error as Error).message} onRetry={() => void profileQ.refetch()} />
      </PageContainer>
    )
  }

  return (
    <ChartsWorkspace
      key={`${activeId}:${profileQ.dataUpdatedAt}`}
      activeId={activeId}
      profile={profileQ.data!}
      viewName={activeSummary?.view_name}
    />
  )
}

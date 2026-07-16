import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, RotateCcw, Save, Terminal, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { SavedChart } from '@/api/types'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const ws = useChartWorkspaceState(activeId, profile, viewName)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveAs, setSaveAs] = useState(false)
  const [saveName, setSaveName] = useState('Untitled chart')
  const [saveDescription, setSaveDescription] = useState('')
  const savedCharts = useQuery({
    queryKey: ['saved-charts', activeId],
    queryFn: () => api.listSavedCharts(activeId),
  })
  const chartOptions = useMemo(() => {
    const items = savedCharts.data ?? []
    const active = ws.activeSavedChart
    return active && !items.some((item) => item.chart_id === active.chart_id)
      ? [active, ...items]
      : items
  }, [savedCharts.data, ws.activeSavedChart])

  const setChartParam = useCallback((chartId: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (chartId) next.set('chart', chartId)
    else next.delete('chart')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const refreshSavedCharts = () => {
    void qc.invalidateQueries({ queryKey: ['saved-charts'] })
  }

  const createChart = useMutation({
    mutationFn: () => api.createSavedChart({
      dataset_id: activeId,
      name: saveName.trim(),
      description: saveDescription.trim() || null,
      spec: ws.spec as unknown as Record<string, unknown>,
    }),
    onSuccess: (chart) => {
      ws.markSaved(chart)
      setChartParam(chart.chart_id)
      setSaveOpen(false)
      refreshSavedCharts()
      toast.success('Chart saved')
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const updateChart = useMutation({
    mutationFn: () => api.patchSavedChart(ws.activeSavedChart!.chart_id, {
      name: ws.activeSavedChart!.name,
      description: ws.activeSavedChart!.description,
      spec: ws.spec as unknown as Record<string, unknown>,
    }),
    onSuccess: (chart) => {
      ws.markSaved(chart)
      refreshSavedCharts()
      toast.success('Chart changes saved')
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const deleteChart = useMutation({
    mutationFn: (chart: SavedChart) => api.deleteSavedChart(chart.chart_id),
    onSuccess: () => {
      ws.markDeleted()
      setChartParam(null)
      refreshSavedCharts()
      toast.success('Saved chart deleted; current chart kept as a draft')
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const chartParam = searchParams.get('chart')
  const activeSavedChartId = ws.activeSavedChart?.chart_id
  const loadSavedChart = ws.loadSavedChart
  useEffect(() => {
    if (
      !chartParam ||
      savedCharts.isLoading ||
      savedCharts.isError ||
      activeSavedChartId === chartParam
    ) return
    const chart = savedCharts.data?.find((item) => item.chart_id === chartParam)
    if (!chart) {
      toast.error('Saved chart was not found for this dataset')
      setChartParam(null)
      return
    }
    if (!loadSavedChart(chart)) {
      setChartParam(activeSavedChartId ?? null)
    }
  }, [
    activeSavedChartId,
    chartParam,
    loadSavedChart,
    savedCharts.data,
    savedCharts.isError,
    savedCharts.isLoading,
    setChartParam,
  ])

  const openSaveDialog = (copy: boolean) => {
    setSaveAs(copy)
    setSaveName(
      copy && ws.activeSavedChart ? `${ws.activeSavedChart.name} copy` : ws.activeSavedChart?.name ?? 'Untitled chart',
    )
    setSaveDescription(ws.activeSavedChart?.description ?? '')
    setSaveOpen(true)
  }

  const loadChart = (chartId: string) => {
    const chart = savedCharts.data?.find((item) => item.chart_id === chartId)
    if (chart && ws.loadSavedChart(chart)) setChartParam(chart.chart_id)
  }

  const removeChart = () => {
    const chart = ws.activeSavedChart
    if (!chart) return
    const warning = ws.isDirty
      ? `Delete “${chart.name}”? Unsaved changes will remain only as the current draft.`
      : `Delete “${chart.name}”? The current chart will remain as an unsaved draft.`
    if (typeof window.confirm !== 'function' || window.confirm(warning)) deleteChart.mutate(chart)
  }

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
          {ws.isDirty ? <Badge variant="warning">Unsaved</Badge> : null}
          <label className="sr-only" htmlFor="saved-chart-select">Saved chart</label>
          <select
            id="saved-chart-select"
            className="h-8 max-w-52 rounded-md border border-border-default bg-surface-1 px-2 text-xs text-fg"
            value={ws.activeSavedChart?.chart_id ?? ''}
            onChange={(event) => event.target.value && loadChart(event.target.value)}
          >
            <option value="">Saved charts…</option>
            {chartOptions.map((chart) => <option key={chart.chart_id} value={chart.chart_id}>{chart.name}</option>)}
          </select>
          {ws.activeSavedChart ? (
            <Button variant="outline" size="sm" className="gap-1" disabled={!ws.isDirty || updateChart.isPending} onClick={() => updateChart.mutate()}>
              <Save className="h-3.5 w-3.5" aria-hidden /> Save changes
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-1" onClick={() => openSaveDialog(false)}>
              <Save className="h-3.5 w-3.5" aria-hidden /> Save
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => openSaveDialog(true)}>Save as</Button>
          {ws.activeSavedChart ? (
            <Button variant="ghost" size="icon" aria-label="Delete saved chart" onClick={removeChart}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="gap-1" onClick={() => {
            if (ws.resetWorkspace()) setChartParam(null)
          }}>
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

      {savedCharts.isError ? (
        <QueryErrorBanner
          message={(savedCharts.error as Error).message}
          onRetry={() => void savedCharts.refetch()}
        />
      ) : null}

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

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title={saveAs ? 'Save chart as' : 'Save chart'} className="max-w-md">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Name</span>
            <Input value={saveName} maxLength={200} autoFocus onChange={(event) => setSaveName(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Description <span className="font-normal text-fg-muted">(optional)</span></span>
            <textarea
              className="min-h-24 w-full rounded-md border border-border-default bg-surface-1 p-3 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/40"
              value={saveDescription}
              maxLength={5_000}
              onChange={(event) => setSaveDescription(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button disabled={!saveName.trim() || createChart.isPending} onClick={() => createChart.mutate()}>
              {createChart.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

export function ChartsPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const dsQ = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const profileQ = useDatasetProfile(activeId)

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

  if (dsQ.isLoading || profileQ.isLoading || profileQ.isPendingProfile) {
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

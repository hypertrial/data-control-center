import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type * as echarts from 'echarts'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { DatasetProfile, SavedChart } from '@/api/types'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { queryResultToCsv } from '@/features/query/queryGridUtils'
import {
  buildLineChartOption,
  buildLineChartSql,
  CHART_MAX_ROWS,
  createDefaultChartSpec,
  getColumnCardinality,
  getColumnSemanticType,
  getFilterColumnNames,
  getNumericColumnNames,
  getSplitColumnNames,
  getTemporalColumnNames,
  getTemporalKind,
  isBucketableTemporalColumn,
  normalizeChartSpec,
  queryResultToChartData,
  validateChartSpec,
  type ChartSpec,
} from '@/features/charts/chartUtils'

function safeParseSavedSpec(chart: SavedChart, activeId: string, profile: DatasetProfile): ChartSpec | null {
  try {
    return normalizeChartSpec(JSON.parse(chart.spec_json) as Partial<ChartSpec>, activeId, profile)
  } catch {
    return null
  }
}

function chartSpecJson(spec: ChartSpec): string {
  return JSON.stringify(spec, null, 2)
}

export function useChartWorkspaceState(activeId: string, profile: DatasetProfile, viewName: string | undefined) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstanceRef = useRef<echarts.ECharts | null>(null)
  const openInSql = useOpenInSql()
  const qc = useQueryClient()
  const [spec, setSpec] = useState<ChartSpec>(() => createDefaultChartSpec(activeId, profile))
  const [hasRun, setHasRun] = useState(false)
  const [lastRunSql, setLastRunSql] = useState('')
  const [selectedSavedChartId, setSelectedSavedChartId] = useState('')
  const runChart = useMutation({ mutationFn: api.runQuery })

  const savedChartsQ = useQuery({
    queryKey: ['saved-charts', activeId],
    queryFn: () => api.listSavedCharts(activeId),
  })
  const createSavedChart = useMutation({
    mutationFn: api.createSavedChart,
    onSuccess: (chart) => {
      setSelectedSavedChartId(chart.chart_id)
      void qc.invalidateQueries({ queryKey: ['saved-charts', activeId] })
      toast.success('Chart saved')
    },
  })
  const patchSavedChart = useMutation({
    mutationFn: ({ chartId, body }: { chartId: string; body: Parameters<typeof api.patchSavedChart>[1] }) =>
      api.patchSavedChart(chartId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-charts', activeId] })
      toast.success('Saved chart updated')
    },
  })
  const deleteSavedChart = useMutation({
    mutationFn: api.deleteSavedChart,
    onSuccess: () => {
      setSelectedSavedChartId('')
      void qc.invalidateQueries({ queryKey: ['saved-charts', activeId] })
      toast.success('Saved chart deleted')
    },
  })

  const temporalColumns = useMemo(() => getTemporalColumnNames(profile), [profile])
  const numericColumns = useMemo(() => getNumericColumnNames(profile), [profile])
  const splitColumns = useMemo(() => getSplitColumnNames(profile), [profile])
  const filterColumns = useMemo(() => getFilterColumnNames(profile), [profile])

  const validation = useMemo(() => validateChartSpec(spec, viewName), [spec, viewName])
  const generatedSql = useMemo(
    () => (validation.valid && viewName ? buildLineChartSql(spec, viewName) : ''),
    [spec, validation.valid, viewName],
  )
  const chartData = useMemo(() => queryResultToChartData(runChart.data, spec), [runChart.data, spec])
  const option = useMemo(() => buildLineChartOption(spec, chartData), [spec, chartData])
  const canRenderChart = hasRun && chartData.length > 0 && !runChart.data?.error
  const settingsChanged = hasRun && !!generatedSql && !!lastRunSql && generatedSql !== lastRunSql
  const selectedSavedChart = savedChartsQ.data?.find((chart) => chart.chart_id === selectedSavedChartId)
  const splitCardinality = spec.splitBy ? getColumnCardinality(profile, spec.splitBy) : null
  const splitWarning = splitCardinality != null && splitCardinality > 25

  useDisposableEChart(
    chartRef,
    canRenderChart,
    () => option,
    [option, canRenderChart],
    (chart) => {
      chartInstanceRef.current = chart
      return () => {
        chartInstanceRef.current = null
      }
    },
  )

  const patchSpec = useCallback((patch: Partial<ChartSpec>) => {
    setSpec((cur) => ({ ...cur, ...patch }))
  }, [])

  const executeSql = useCallback(
    (sql: string) => {
      if (!sql) return
      setHasRun(true)
      setLastRunSql(sql)
      runChart.mutate({ sql, max_rows: CHART_MAX_ROWS })
    },
    [runChart],
  )

  const execute = useCallback(() => {
    if (!validation.valid || !generatedSql) return
    executeSql(generatedSql)
  }, [validation.valid, generatedSql, executeSql])

  useEffect(() => {
    if (!hasRun || !generatedSql || generatedSql === lastRunSql || !validation.valid) return
    const timer = window.setTimeout(() => executeSql(generatedSql), 450)
    return () => window.clearTimeout(timer)
  }, [executeSql, generatedSql, hasRun, lastRunSql, validation.valid])

  const runError = runChart.isError ? (runChart.error as Error).message : runChart.data?.error

  const saveAsNew = useCallback(() => {
    const name = window.prompt('Chart name', spec.title || profile.name || 'Chart')
    if (!name?.trim()) return
    createSavedChart.mutate({ dataset_id: activeId, name: name.trim(), spec_json: chartSpecJson(spec) })
  }, [activeId, createSavedChart, profile.name, spec])

  const updateSaved = useCallback(() => {
    if (!selectedSavedChartId) return
    patchSavedChart.mutate({ chartId: selectedSavedChartId, body: { spec_json: chartSpecJson(spec) } })
  }, [patchSavedChart, selectedSavedChartId, spec])

  const renameSaved = useCallback(() => {
    if (!selectedSavedChart) return
    const name = window.prompt('Chart name', selectedSavedChart.name)
    if (!name?.trim()) return
    patchSavedChart.mutate({ chartId: selectedSavedChart.chart_id, body: { name: name.trim() } })
  }, [patchSavedChart, selectedSavedChart])

  const duplicateSaved = useCallback(() => {
    const name = window.prompt('Chart name', `${selectedSavedChart?.name ?? spec.title} copy`)
    if (!name?.trim()) return
    createSavedChart.mutate({ dataset_id: activeId, name: name.trim(), spec_json: chartSpecJson(spec) })
  }, [activeId, createSavedChart, selectedSavedChart?.name, spec])

  const removeSaved = useCallback(() => {
    if (!selectedSavedChartId || !window.confirm('Delete this saved chart?')) return
    deleteSavedChart.mutate(selectedSavedChartId)
  }, [deleteSavedChart, selectedSavedChartId])

  const loadSaved = useCallback(
    (chartId: string) => {
      setSelectedSavedChartId(chartId)
      const chart = savedChartsQ.data?.find((item) => item.chart_id === chartId)
      if (!chart) return
      const parsed = safeParseSavedSpec(chart, activeId, profile)
      if (!parsed) {
        toast.error('Saved chart spec is invalid')
        return
      }
      setSpec(parsed)
      setHasRun(false)
      setLastRunSql('')
      runChart.reset()
    },
    [activeId, profile, runChart, savedChartsQ.data],
  )

  const resetWorkspace = useCallback(() => {
    setSpec(createDefaultChartSpec(activeId, profile))
    setSelectedSavedChartId('')
    setHasRun(false)
    setLastRunSql('')
    runChart.reset()
  }, [activeId, profile, runChart])

  const copyCsv = useCallback(() => {
    if (!runChart.data || runChart.data.error) return
    void navigator.clipboard.writeText(queryResultToCsv(runChart.data.columns, runChart.data.rows))
    toast.success('Chart data copied as CSV')
  }, [runChart.data])

  const copySpec = useCallback(() => {
    void navigator.clipboard.writeText(chartSpecJson(spec))
    toast.success('Chart spec copied')
  }, [spec])

  const copyPng = useCallback(() => {
    const chart = chartInstanceRef.current
    if (!chart) return
    void navigator.clipboard.writeText(chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#111827' }))
    toast.success('Chart PNG data URL copied')
  }, [])

  const resetZoom = useCallback(() => {
    chartInstanceRef.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
  }, [])

  return {
    activeId,
    profile,
    chartRef,
    spec,
    patchSpec,
    hasRun,
    selectedSavedChartId,
    selectedSavedChart,
    savedChartsQ,
    runChart,
    temporalColumns,
    numericColumns,
    splitColumns,
    filterColumns,
    validation,
    generatedSql,
    chartData,
    canRenderChart,
    settingsChanged,
    splitWarning,
    splitCardinality,
    runError,
    execute,
    executeSql,
    openInSql,
    saveAsNew,
    updateSaved,
    renameSaved,
    duplicateSaved,
    removeSaved,
    loadSaved,
    resetWorkspace,
    copyCsv,
    copySpec,
    copyPng,
    resetZoom,
    getColumnSemanticType,
    isBucketableTemporalColumn,
    getTemporalKind,
  }
}

export type ChartWorkspaceState = ReturnType<typeof useChartWorkspaceState>

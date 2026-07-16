import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type * as echarts from 'echarts'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { DatasetProfile, SavedChart } from '@/api/types'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { queryResultToCsv } from '@/features/query/queryGridUtils'
import { downloadDataUrl, downloadText, safeDownloadName } from '@/lib/download'
import {
  buildChartOption,
  buildChartSql,
  CHART_MAX_ROWS,
  createDefaultChartSpec,
  getColumnCardinality,
  getColumnIsInteger,
  getColumnSemanticType,
  getFilterColumnNames,
  getNumericColumnNames,
  getCategoryColumnNames,
  getSplitColumnNames,
  getTemporalColumnNames,
  getTemporalKind,
  isBucketableTemporalColumn,
  normalizeChartSpec,
  sortColumnNamesAsc,
  queryResultToChartData,
  validateChartSpec,
  type ChartSpec,
} from '@/features/charts/chartUtils'

function chartSpecJson(spec: ChartSpec): string {
  return JSON.stringify(spec, null, 2)
}

export function useChartWorkspaceState(activeId: string, profile: DatasetProfile, viewName: string | undefined) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstanceRef = useRef<echarts.ECharts | null>(null)
  const openInSql = useOpenInSql()
  const [spec, setSpec] = useState<ChartSpec>(() => createDefaultChartSpec(activeId, profile))
  const [activeSavedChart, setActiveSavedChart] = useState<SavedChart | null>(null)
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null)
  const [lastRunSql, setLastRunSql] = useState('')
  const runChart = useMutation({ mutationFn: api.runQuery })
  const { mutate: runChartQuery, reset: resetRunChart } = runChart

  const temporalColumns = useMemo(() => sortColumnNamesAsc(getTemporalColumnNames(profile)), [profile])
  const numericColumns = useMemo(() => sortColumnNamesAsc(getNumericColumnNames(profile)), [profile])
  const categoryColumns = useMemo(() => sortColumnNamesAsc(getCategoryColumnNames(profile)), [profile])
  const splitColumns = useMemo(() => sortColumnNamesAsc(getSplitColumnNames(profile)), [profile])
  const filterColumns = useMemo(() => sortColumnNamesAsc(getFilterColumnNames(profile)), [profile])

  const validation = useMemo(() => validateChartSpec(spec, viewName, profile), [spec, viewName, profile])
  const generatedSql = useMemo(
    () => (validation.valid && viewName ? buildChartSql(spec, viewName) : ''),
    [spec, validation.valid, viewName],
  )
  const chartData = useMemo(() => queryResultToChartData(runChart.data, spec), [runChart.data, spec])
  const option = useMemo(() => buildChartOption(spec, chartData), [spec, chartData])
  const canRenderChart = validation.valid && chartData.length > 0 && !runChart.data?.error
  const settingsChanged = !!generatedSql && !!lastRunSql && generatedSql !== lastRunSql
  const splitCardinality = spec.splitBy ? getColumnCardinality(profile, spec.splitBy) : null
  const splitWarning = splitCardinality != null && splitCardinality > 25
  const defaultBaseline = useMemo(
    () => JSON.stringify(createDefaultChartSpec(activeId, profile)),
    [activeId, profile],
  )
  const isDirty = JSON.stringify(spec) !== (savedBaseline ?? defaultBaseline)

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
      setLastRunSql(sql)
      runChartQuery({ sql, max_rows: CHART_MAX_ROWS })
    },
    [runChartQuery],
  )

  const execute = useCallback(() => {
    if (!validation.valid || !generatedSql) return
    executeSql(generatedSql)
  }, [validation.valid, generatedSql, executeSql])

  useEffect(() => {
    if (!validation.valid || !generatedSql || generatedSql === lastRunSql) return
    const timer = window.setTimeout(() => executeSql(generatedSql), 450)
    return () => window.clearTimeout(timer)
  }, [executeSql, generatedSql, lastRunSql, validation.valid])

  const runError = runChart.isError ? (runChart.error as Error).message : runChart.data?.error

  const resetWorkspace = useCallback(() => {
    if (
      isDirty &&
      typeof window.confirm === 'function' &&
      !window.confirm('Discard unsaved chart changes?')
    ) return false
    setSpec(createDefaultChartSpec(activeId, profile))
    setActiveSavedChart(null)
    setSavedBaseline(null)
    setLastRunSql('')
    resetRunChart()
    return true
  }, [activeId, isDirty, profile, resetRunChart])

  const downloadCsv = useCallback(() => {
    if (!runChart.data || runChart.data.error) return
    const name = safeDownloadName(profile.name, activeSavedChart?.name ?? 'chart')
    downloadText(
      queryResultToCsv(runChart.data.columns, runChart.data.rows),
      `${name}.csv`,
      'text/csv;charset=utf-8',
    )
    toast.success('Chart data downloaded')
  }, [activeSavedChart?.name, profile.name, runChart.data])

  const downloadSpec = useCallback(() => {
    const name = safeDownloadName(profile.name, activeSavedChart?.name ?? 'chart')
    downloadText(chartSpecJson(spec), `${name}.json`, 'application/json;charset=utf-8')
    toast.success('Chart spec downloaded')
  }, [activeSavedChart?.name, profile.name, spec])

  const downloadPng = useCallback(() => {
    const chart = chartInstanceRef.current
    if (!chart) return
    const name = safeDownloadName(profile.name, activeSavedChart?.name ?? 'chart')
    downloadDataUrl(
      chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#111827' }),
      `${name}.png`,
    )
    toast.success('Chart image downloaded')
  }, [activeSavedChart?.name, profile.name])

  const loadSavedChart = useCallback(
    (chart: SavedChart) => {
      if (
        isDirty &&
        typeof window.confirm === 'function' &&
        !window.confirm('Discard unsaved chart changes?')
      ) return false
      const normalized = normalizeChartSpec(chart.spec as Partial<ChartSpec>, activeId, profile)
      setSpec(normalized)
      setActiveSavedChart(chart)
      setSavedBaseline(JSON.stringify(normalized))
      setLastRunSql('')
      resetRunChart()
      return true
    },
    [activeId, isDirty, profile, resetRunChart],
  )

  const markSaved = useCallback((chart: SavedChart) => {
    setActiveSavedChart(chart)
    setSavedBaseline(JSON.stringify(spec))
  }, [spec])

  const markDeleted = useCallback(() => {
    setActiveSavedChart(null)
    setSavedBaseline('__deleted_saved_chart__')
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
    runChart,
    temporalColumns,
    numericColumns,
    categoryColumns,
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
    resetWorkspace,
    downloadCsv,
    downloadSpec,
    downloadPng,
    activeSavedChart,
    isDirty,
    loadSavedChart,
    markSaved,
    markDeleted,
    resetZoom,
    getColumnSemanticType,
    getColumnIsInteger,
    isBucketableTemporalColumn,
    getTemporalKind,
  }
}

export type ChartWorkspaceState = ReturnType<typeof useChartWorkspaceState>

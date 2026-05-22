import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type * as echarts from 'echarts'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { DatasetProfile } from '@/api/types'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { queryResultToCsv } from '@/features/query/queryGridUtils'
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
  const [lastRunSql, setLastRunSql] = useState('')
  const runChart = useMutation({ mutationFn: api.runQuery })
  const { mutate: runChartQuery, reset: resetRunChart } = runChart

  const temporalColumns = useMemo(() => getTemporalColumnNames(profile), [profile])
  const numericColumns = useMemo(() => getNumericColumnNames(profile), [profile])
  const categoryColumns = useMemo(() => getCategoryColumnNames(profile), [profile])
  const splitColumns = useMemo(() => getSplitColumnNames(profile), [profile])
  const filterColumns = useMemo(() => getFilterColumnNames(profile), [profile])

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
    setSpec(createDefaultChartSpec(activeId, profile))
    setLastRunSql('')
    resetRunChart()
  }, [activeId, profile, resetRunChart])

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
    copyCsv,
    copySpec,
    copyPng,
    resetZoom,
    getColumnSemanticType,
    getColumnIsInteger,
    isBucketableTemporalColumn,
    getTemporalKind,
  }
}

export type ChartWorkspaceState = ReturnType<typeof useChartWorkspaceState>

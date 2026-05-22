import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Copy,
  Download,
  LineChart,
  Play,
  Plus,
  RotateCcw,
  Save,
  Terminal,
  Trash2,
  X,
  ZoomOut,
} from 'lucide-react'
import type * as echarts from 'echarts'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { DatasetProfile, SavedChart } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { PageContainer } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { queryResultToCsv } from '@/features/query/queryGridUtils'
import { useUiStore } from '@/store/uiStore'
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
  type ChartAggregation,
  type ChartBucket,
  type ChartFilterOperator,
  type ChartSpec,
  type ChartYAxisScale,
} from '@/features/charts/chartUtils'

const AGGREGATIONS: Array<{ value: ChartAggregation; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'avg', label: 'Average' },
  { value: 'sum', label: 'Sum' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'median', label: 'Median' },
  { value: 'stddev', label: 'Std dev' },
  { value: 'p25', label: 'p25' },
  { value: 'p75', label: 'p75' },
  { value: 'count', label: 'Count' },
  { value: 'count_distinct', label: 'Count distinct' },
]

const BUCKETS: Array<{ value: ChartBucket; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

const FILTER_OPERATORS: Array<{ value: ChartFilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'in', label: 'in' },
  { value: 'is_null', label: 'is null' },
  { value: 'is_not_null', label: 'is not null' },
]

const Y_SCALE_OPTIONS: Array<{ value: ChartYAxisScale; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'zero', label: 'Start at zero' },
  { value: 'manual', label: 'Manual' },
]

function filterOperatorsForSemantic(semantic: string): Array<{ value: ChartFilterOperator; label: string }> {
  const nullChecks = FILTER_OPERATORS.filter((operator) => operator.value === 'is_null' || operator.value === 'is_not_null')
  if (semantic === 'numeric' || semantic === 'datetime') {
    return FILTER_OPERATORS.filter((operator) =>
      ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null', 'is_not_null'].includes(operator.value),
    )
  }
  if (semantic === 'text') {
    return FILTER_OPERATORS.filter((operator) =>
      ['eq', 'neq', 'contains', 'starts_with', 'in', 'is_null', 'is_not_null'].includes(operator.value),
    )
  }
  if (['categorical', 'boolean_like', 'id_like'].includes(semantic)) {
    return FILTER_OPERATORS.filter((operator) =>
      ['eq', 'neq', 'in', 'is_null', 'is_not_null'].includes(operator.value),
    )
  }
  return [...FILTER_OPERATORS, ...nullChecks].filter(
    (operator, index, all) => all.findIndex((item) => item.value === operator.value) === index,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs text-fg-muted">
      <span className="block font-medium text-fg">{label}</span>
      {children}
    </label>
  )
}

function ControlGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-border-default/80 bg-black/10 p-2">
      <h3 className="text-xs font-semibold text-fg">{title}</h3>
      {children}
    </section>
  )
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-border-default bg-black/20 px-2 text-xs text-fg">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[hsl(var(--accent))]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function nativeSelectClassName(disabled?: boolean): string {
  return cn(
    'h-8 w-full rounded-md border border-border-default bg-black/30 px-2 text-sm text-fg outline-none',
    'focus:border-border-accent focus:ring-2 focus:ring-[hsl(var(--accent)_/_0.18)]',
    disabled && 'cursor-not-allowed opacity-50',
  )
}

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

function ChartsWorkspace({
  activeId,
  profile,
  viewName,
}: {
  activeId: string
  profile: DatasetProfile
  viewName: string | undefined
}) {
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
  const chartData = useMemo(
    () => queryResultToChartData(runChart.data, spec),
    [runChart.data, spec],
  )
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

  const patchSpec = (patch: Partial<ChartSpec>) => {
    setSpec((cur) => ({ ...cur, ...patch }))
  }

  const executeSql = useCallback(
    (sql: string) => {
      if (!sql) return
      setHasRun(true)
      setLastRunSql(sql)
      runChart.mutate({ sql, max_rows: CHART_MAX_ROWS })
    },
    [runChart],
  )

  const execute = () => {
    if (!validation.valid || !generatedSql) return
    executeSql(generatedSql)
  }

  useEffect(() => {
    if (!hasRun || !generatedSql || generatedSql === lastRunSql || !validation.valid) return
    const timer = window.setTimeout(() => executeSql(generatedSql), 450)
    return () => window.clearTimeout(timer)
  }, [executeSql, generatedSql, hasRun, lastRunSql, validation.valid])

  const runError = runChart.isError ? (runChart.error as Error).message : runChart.data?.error
  const valueDisabled = (operator: ChartFilterOperator) => operator === 'is_null' || operator === 'is_not_null'

  const saveAsNew = () => {
    const name = window.prompt('Chart name', spec.title || profile.name || 'Chart')
    if (!name?.trim()) return
    createSavedChart.mutate({ dataset_id: activeId, name: name.trim(), spec_json: chartSpecJson(spec) })
  }

  const updateSaved = () => {
    if (!selectedSavedChartId) return
    patchSavedChart.mutate({ chartId: selectedSavedChartId, body: { spec_json: chartSpecJson(spec) } })
  }

  const renameSaved = () => {
    if (!selectedSavedChart) return
    const name = window.prompt('Chart name', selectedSavedChart.name)
    if (!name?.trim()) return
    patchSavedChart.mutate({ chartId: selectedSavedChart.chart_id, body: { name: name.trim() } })
  }

  const duplicateSaved = () => {
    const name = window.prompt('Chart name', `${selectedSavedChart?.name ?? spec.title} copy`)
    if (!name?.trim()) return
    createSavedChart.mutate({ dataset_id: activeId, name: name.trim(), spec_json: chartSpecJson(spec) })
  }

  const removeSaved = () => {
    if (!selectedSavedChartId || !window.confirm('Delete this saved chart?')) return
    deleteSavedChart.mutate(selectedSavedChartId)
  }

  const loadSaved = (chartId: string) => {
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
  }

  const copyCsv = () => {
    if (!runChart.data || runChart.data.error) return
    void navigator.clipboard.writeText(queryResultToCsv(runChart.data.columns, runChart.data.rows))
    toast.success('Chart data copied as CSV')
  }

  const copySpec = () => {
    void navigator.clipboard.writeText(chartSpecJson(spec))
    toast.success('Chart spec copied')
  }

  const copyPng = () => {
    const chart = chartInstanceRef.current
    if (!chart) return
    void navigator.clipboard.writeText(chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#111827' }))
    toast.success('Chart PNG data URL copied')
  }

  const resetZoom = () => {
    chartInstanceRef.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
  }

  return (
    <PageContainer className="flex h-full min-h-[calc(100vh-9rem)] flex-col gap-3 overflow-hidden p-4 space-y-0">
      <div className="flex flex-none flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <LineChart className="h-4 w-4 text-fg-muted" aria-hidden />
            Charts
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Build and save customizable line charts from the active dataset.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => {
              setSpec(createDefaultChartSpec(activeId, profile))
              setSelectedSavedChartId('')
              setHasRun(false)
              setLastRunSql('')
              runChart.reset()
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </Button>
          <Tooltip content="Open generated SQL in the SQL tab">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={!generatedSql}
              onClick={() => openInSql(generatedSql)}
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden />
              SQL
            </Button>
          </Tooltip>
          <Button
            size="sm"
            className="gap-1"
            loading={runChart.isPending}
            disabled={!validation.valid || runChart.isPending}
            onClick={execute}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            Run chart
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[22rem_minmax(0,1fr)] 2xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden rounded-lg border border-border-default bg-black/20 p-2.5">
          <div className="grid max-h-full gap-2 overflow-y-auto pr-1">
            <ControlGroup title="Saved Charts">
              <div className="grid gap-2">
                <select className={nativeSelectClassName()} value={selectedSavedChartId} onChange={(e) => loadSaved(e.target.value)}>
                  <option value="">Unsaved chart</option>
                  {(savedChartsQ.data ?? []).map((chart) => (
                    <option key={chart.chart_id} value={chart.chart_id}>
                      {chart.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-1">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={saveAsNew}>
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={!selectedSavedChartId} onClick={updateSaved}>
                    Update
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={!selectedSavedChartId} onClick={duplicateSaved}>
                    Duplicate
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <Button type="button" variant="outline" size="sm" disabled={!selectedSavedChartId} onClick={renameSaved}>
                    Rename
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!selectedSavedChartId} onClick={removeSaved}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </div>
            </ControlGroup>

            <ControlGroup title="Data">
              <Field label="X axis">
                <select
                  className={nativeSelectClassName()}
                  value={spec.xColumn}
                  onChange={(e) => {
                    const xColumn = e.target.value
                    const xColumnBucketable = isBucketableTemporalColumn(profile, xColumn)
                    patchSpec({
                      xColumn,
                      xColumnBucketable,
                      xColumnTemporalKind: getTemporalKind(profile, xColumn),
                      xAxisLabel: xColumn,
                      bucket: xColumnBucketable ? spec.bucket : 'none',
                    })
                  }}
                >
                  {temporalColumns.length === 0 ? <option value="">No temporal columns</option> : null}
                  {temporalColumns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </Field>

              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-fg">Y variables</legend>
                <div className="max-h-36 space-y-0.5 overflow-auto rounded-md border border-border-default bg-black/20 p-2">
                  {numericColumns.length === 0 ? (
                    <p className="text-xs text-fg-muted">No numeric variables detected.</p>
                  ) : (
                    numericColumns.map((column) => {
                      const checked = spec.yColumns.includes(column)
                      const disabled = !!spec.splitBy && !checked && spec.yColumns.length >= 1
                      return (
                        <label key={column} className={cn('flex items-center gap-2 rounded px-1 py-0.5 text-xs text-fg', disabled && 'opacity-50')}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[hsl(var(--accent))]"
                            checked={checked}
                            disabled={disabled}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...spec.yColumns, column]
                                : spec.yColumns.filter((name) => name !== column)
                              patchSpec({ yColumns: spec.splitBy ? next.slice(0, 1) : next })
                            }}
                          />
                          <span className="min-w-0 truncate" title={column}>
                            {column}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Aggregation">
                  <select
                    className={nativeSelectClassName()}
                    value={spec.aggregation}
                    onChange={(e) => {
                      const aggregation = e.target.value as ChartAggregation
                      patchSpec({ aggregation, bucket: aggregation === 'none' ? 'none' : spec.bucket })
                    }}
                  >
                    {AGGREGATIONS.map((aggregation) => (
                      <option key={aggregation.value} value={aggregation.value}>
                        {aggregation.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Bucket">
                  <select
                    className={nativeSelectClassName(spec.aggregation === 'none' || !spec.xColumnBucketable)}
                    value={spec.bucket}
                    disabled={spec.aggregation === 'none' || !spec.xColumnBucketable}
                    onChange={(e) => patchSpec({ bucket: e.target.value as ChartBucket })}
                  >
                    {BUCKETS.map((bucket) => (
                      <option key={bucket.value} value={bucket.value}>
                        {bucket.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </ControlGroup>

            <ControlGroup title="Filters">
              <div className="space-y-2">
                {spec.filters.map((filter) => (
                  <div key={filter.id} className="grid grid-cols-[1fr_6rem_1fr_auto] gap-1">
                    <select
                      className={nativeSelectClassName()}
                      value={filter.column}
                      onChange={(e) =>
                        patchSpec({
                          filters: spec.filters.map((item) => {
                            if (item.id !== filter.id) return item
                            const column = e.target.value
                            const operators = filterOperatorsForSemantic(getColumnSemanticType(profile, column))
                            const operator = operators.some((candidate) => candidate.value === item.operator)
                              ? item.operator
                              : operators[0]?.value ?? 'eq'
                            return { ...item, column, operator }
                          }),
                        })
                      }
                    >
                      {filterColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                    <select
                      className={nativeSelectClassName()}
                      value={filter.operator}
                      onChange={(e) =>
                        patchSpec({
                          filters: spec.filters.map((item) => item.id === filter.id ? { ...item, operator: e.target.value as ChartFilterOperator } : item),
                        })
                      }
                    >
                      {filterOperatorsForSemantic(getColumnSemanticType(profile, filter.column)).map((operator) => (
                        <option key={operator.value} value={operator.value}>
                          {operator.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-8"
                      value={filter.value}
                      disabled={valueDisabled(filter.operator)}
                      placeholder={filter.operator === 'in' ? 'a, b, c' : 'Value'}
                      onChange={(e) =>
                        patchSpec({
                          filters: spec.filters.map((item) => item.id === filter.id ? { ...item, value: e.target.value } : item),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Remove filter"
                      onClick={() => patchSpec({ filters: spec.filters.filter((item) => item.id !== filter.id) })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1"
                  disabled={!filterColumns.length}
                  onClick={() =>
                    patchSpec({
                      filters: [
                        ...spec.filters,
                        { id: crypto.randomUUID(), column: filterColumns[0] ?? '', operator: 'eq', value: '' },
                      ],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add filter
                </Button>
              </div>
            </ControlGroup>

            <ControlGroup title="Split">
              <Field label="Split by">
                <select
                  className={nativeSelectClassName()}
                  value={spec.splitBy}
                  onChange={(e) => patchSpec({ splitBy: e.target.value, yColumns: e.target.value ? spec.yColumns.slice(0, 1) : spec.yColumns })}
                >
                  <option value="">None</option>
                  {splitColumns.map((column) => (
                    <option key={column} value={column}>
                      {column} · {getColumnSemanticType(profile, column)}
                    </option>
                  ))}
                </select>
              </Field>
              {splitWarning ? (
                <p className="text-xs text-[hsl(var(--severity-warning))]">
                  {spec.splitBy} has about {formatCount(splitCardinality)} values; the legend may be dense.
                </p>
              ) : null}
            </ControlGroup>

            <ControlGroup title="Scale">
              <Field label="Y scale">
                <select className={nativeSelectClassName()} value={spec.yAxisScale} onChange={(e) => patchSpec({ yAxisScale: e.target.value as ChartYAxisScale })}>
                  {Y_SCALE_OPTIONS.map((scale) => (
                    <option key={scale.value} value={scale.value}>
                      {scale.label}
                    </option>
                  ))}
                </select>
              </Field>
              {spec.yAxisScale === 'manual' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Y min">
                    <Input className="h-8" value={spec.yAxisMin} onChange={(e) => patchSpec({ yAxisMin: e.target.value })} />
                  </Field>
                  <Field label="Y max">
                    <Input className="h-8" value={spec.yAxisMax} onChange={(e) => patchSpec({ yAxisMax: e.target.value })} />
                  </Field>
                </div>
              ) : null}
              <div className="space-y-2">
                {spec.referenceLines.map((line) => (
                  <div key={line.id} className="grid grid-cols-[1fr_5rem_auto] gap-1">
                    <Input
                      className="h-8"
                      value={line.label}
                      placeholder="Label"
                      onChange={(e) =>
                        patchSpec({
                          referenceLines: spec.referenceLines.map((item) => item.id === line.id ? { ...item, label: e.target.value } : item),
                        })
                      }
                    />
                    <Input
                      className="h-8"
                      value={line.value}
                      placeholder="Value"
                      onChange={(e) =>
                        patchSpec({
                          referenceLines: spec.referenceLines.map((item) => item.id === line.id ? { ...item, value: e.target.value } : item),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Remove reference line"
                      onClick={() => patchSpec({ referenceLines: spec.referenceLines.filter((item) => item.id !== line.id) })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1"
                  onClick={() => patchSpec({ referenceLines: [...spec.referenceLines, { id: crypto.randomUUID(), label: 'Reference', value: '' }] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add reference line
                </Button>
              </div>
            </ControlGroup>

            <ControlGroup title="Display">
              <Field label="Title">
                <Input className="h-8" value={spec.title} onChange={(e) => patchSpec({ title: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="X label">
                  <Input className="h-8" value={spec.xAxisLabel} onChange={(e) => patchSpec({ xAxisLabel: e.target.value })} />
                </Field>
                <Field label="Y label">
                  <Input className="h-8" value={spec.yAxisLabel} onChange={(e) => patchSpec({ yAxisLabel: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ToggleField label="Legend" checked={spec.showLegend} onChange={(showLegend) => patchSpec({ showLegend })} />
                <ToggleField label="Smooth" checked={spec.smooth} onChange={(smooth) => patchSpec({ smooth })} />
                <ToggleField label="Points" checked={spec.showPoints} onChange={(showPoints) => patchSpec({ showPoints })} />
                <ToggleField label="Connect nulls" checked={spec.connectNulls} onChange={(connectNulls) => patchSpec({ connectNulls })} />
                <ToggleField label="Zoom slider" checked={spec.showDataZoom} onChange={(showDataZoom) => patchSpec({ showDataZoom })} />
              </div>
            </ControlGroup>

            <ControlGroup title="Export">
              <div className="grid grid-cols-2 gap-1">
                <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!canRenderChart} onClick={copyPng}>
                  <Download className="h-3.5 w-3.5" /> PNG
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!runChart.data || !!runChart.data.error} onClick={copyCsv}>
                  <Copy className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={copySpec}>
                  <Copy className="h-3.5 w-3.5" /> Spec
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!canRenderChart} onClick={resetZoom}>
                  <ZoomOut className="h-3.5 w-3.5" /> Zoom
                </Button>
              </div>
            </ControlGroup>
          </div>
        </aside>

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
          ) : !hasRun ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted">
              Configure the chart and run it to preview results. Data-setting changes rerun automatically after the first run.
            </div>
          ) : runChart.isPending ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-fg-muted">
              Running chart query…
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted">
              The chart query returned no plottable rows.
            </div>
          ) : (
            <div ref={chartRef} className="min-h-[24rem] flex-1" data-testid="charts-preview" />
          )}
        </section>
      </div>
    </PageContainer>
  )
}

export function ChartsPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const dsQ = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const profileQ = useQuery({
    queryKey: ['profile', activeId],
    queryFn: () => api.fetchDatasetProfile(activeId!),
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

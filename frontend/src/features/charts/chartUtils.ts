import type { EChartsCoreOption } from 'echarts'
import type { ColumnProfile, DatasetProfile, QueryResult, SemanticType } from '@/api/types'
import { chartAxisLabelStyle, chartPalette, chartTooltip, hslFromRootVar } from '@/lib/chartTheme'
import { formatAnalyticsSql, quoteIdent, quoteLiteral } from '@/lib/sql'

export const CHART_MAX_ROWS = 5000
export const CHART_SPEC_VERSION = 2

export type ChartAggregation =
  | 'none'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'median'
  | 'stddev'
  | 'p25'
  | 'p75'
  | 'count'
  | 'count_distinct'
export type ChartBucket = 'none' | 'day' | 'week' | 'month' | 'quarter' | 'year'
export type ChartFilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'in'
  | 'is_null'
  | 'is_not_null'
export type ChartYAxisScale = 'auto' | 'zero' | 'manual'

export type ChartFilter = {
  id: string
  column: string
  operator: ChartFilterOperator
  value: string
}

export type ChartReferenceLine = {
  id: string
  label: string
  value: string
}

export type ChartSpec = {
  version: number
  datasetId: string
  chartType: 'line'
  xColumn: string
  xColumnBucketable: boolean
  xColumnTemporalKind: 'continuous_datetime' | 'discrete_period' | null
  yColumns: string[]
  aggregation: ChartAggregation
  bucket: ChartBucket
  filters: ChartFilter[]
  splitBy: string
  yAxisScale: ChartYAxisScale
  yAxisMin: string
  yAxisMax: string
  referenceLines: ChartReferenceLine[]
  showDataZoom: boolean
  title: string
  showLegend: boolean
  smooth: boolean
  showPoints: boolean
  connectNulls: boolean
  xAxisLabel: string
  yAxisLabel: string
}

export type ChartDataPoint = {
  x: string | number
  values: Record<string, number | null>
}

export type ChartValidation = {
  valid: boolean
  reason: string | null
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names.filter(Boolean))]
}

export function getTemporalColumnNames(profile: DatasetProfile | undefined): string[] {
  if (!profile) return []
  const names = new Set<string>()
  if (profile.primary_temporal_column?.name) names.add(profile.primary_temporal_column.name)
  for (const c of profile.temporal_columns) names.add(c.name)
  for (const c of profile.column_profiles) {
    if (c.semantic_type === 'datetime') names.add(c.name)
  }
  return [...names]
}

function columnProfile(profile: DatasetProfile | undefined, column: string): ColumnProfile | undefined {
  return profile?.column_profiles.find((c) => c.name === column)
}

export function getColumnSemanticType(profile: DatasetProfile | undefined, column: string): SemanticType | 'unknown' {
  return columnProfile(profile, column)?.semantic_type ?? 'unknown'
}

export function isBucketableTemporalColumn(profile: DatasetProfile | undefined, column: string): boolean {
  if (!profile || !column) return false
  const temporalInfo = [
    ...(profile.primary_temporal_column ? [profile.primary_temporal_column] : []),
    ...profile.temporal_columns,
  ].find((c) => c.name === column)
  if (temporalInfo) return temporalInfo.kind === 'continuous_datetime'
  return profile.column_profiles.some((c) => c.name === column && c.semantic_type === 'datetime')
}

export function getTemporalKind(
  profile: DatasetProfile | undefined,
  column: string,
): 'continuous_datetime' | 'discrete_period' | null {
  if (!profile || !column) return null
  const temporalInfo = [
    ...(profile.primary_temporal_column ? [profile.primary_temporal_column] : []),
    ...profile.temporal_columns,
  ].find((c) => c.name === column)
  if (temporalInfo) return temporalInfo.kind
  return columnProfile(profile, column)?.semantic_type === 'datetime' ? 'continuous_datetime' : null
}

export function getNumericColumnNames(profile: DatasetProfile | undefined): string[] {
  if (!profile) return []
  const numeric = new Set(
    profile.column_profiles.filter((c) => c.semantic_type === 'numeric').map((c) => c.name),
  )
  if (!numeric.size && profile.measure_candidates.length) {
    return profile.measure_candidates.map((c) => c.name)
  }

  const ordered: string[] = []
  for (const c of profile.measure_candidates) {
    if (numeric.has(c.name) && !ordered.includes(c.name)) ordered.push(c.name)
  }
  for (const name of numeric) {
    if (!ordered.includes(name)) ordered.push(name)
  }
  return ordered
}

export function getSplitColumnNames(profile: DatasetProfile | undefined): string[] {
  if (!profile) return []
  return profile.column_profiles
    .filter((c) => ['categorical', 'boolean_like', 'id_like'].includes(c.semantic_type))
    .map((c) => c.name)
}

export function getFilterColumnNames(profile: DatasetProfile | undefined): string[] {
  if (!profile) return []
  return profile.column_profiles.map((c) => c.name)
}

export function getColumnCardinality(profile: DatasetProfile | undefined, column: string): number | null {
  return columnProfile(profile, column)?.cardinality ?? null
}

export function createDefaultChartSpec(datasetId: string, profile: DatasetProfile | undefined): ChartSpec {
  const xColumn = getTemporalColumnNames(profile)[0] ?? ''
  const yColumns = getNumericColumnNames(profile).filter((name) => name !== xColumn).slice(0, 3)
  const xColumnBucketable = isBucketableTemporalColumn(profile, xColumn)
  return {
    version: CHART_SPEC_VERSION,
    datasetId,
    chartType: 'line',
    xColumn,
    xColumnBucketable,
    xColumnTemporalKind: getTemporalKind(profile, xColumn),
    yColumns,
    aggregation: 'avg',
    bucket: xColumnBucketable ? 'month' : 'none',
    filters: [],
    splitBy: '',
    yAxisScale: 'auto',
    yAxisMin: '',
    yAxisMax: '',
    referenceLines: [],
    showDataZoom: true,
    title: profile?.name ? `${profile.name} trends` : 'Dataset trends',
    showLegend: true,
    smooth: false,
    showPoints: false,
    connectNulls: false,
    xAxisLabel: xColumn,
    yAxisLabel: '',
  }
}

export function normalizeChartSpec(
  raw: Partial<ChartSpec> | undefined,
  datasetId: string,
  profile: DatasetProfile | undefined,
): ChartSpec {
  const base = createDefaultChartSpec(datasetId, profile)
  if (!raw || typeof raw !== 'object') return base
  const yColumns = uniqueNames(Array.isArray(raw.yColumns) ? raw.yColumns : base.yColumns)
  const splitBy = typeof raw.splitBy === 'string' ? raw.splitBy : ''
  return {
    ...base,
    ...raw,
    version: CHART_SPEC_VERSION,
    datasetId,
    chartType: 'line',
    yColumns: splitBy && yColumns.length > 1 ? yColumns.slice(0, 1) : yColumns,
    filters: Array.isArray(raw.filters) ? raw.filters : [],
    referenceLines: Array.isArray(raw.referenceLines) ? raw.referenceLines : [],
    splitBy,
    xColumnBucketable: isBucketableTemporalColumn(profile, raw.xColumn ?? base.xColumn),
    xColumnTemporalKind: getTemporalKind(profile, raw.xColumn ?? base.xColumn),
  }
}

export function validateChartSpec(spec: ChartSpec, viewName: string | undefined): ChartValidation {
  if (!spec.datasetId || !viewName) return { valid: false, reason: 'Select a dataset to build a chart.' }
  if (!spec.xColumn) return { valid: false, reason: 'Choose a temporal column for the X axis.' }
  if (!spec.yColumns.length) return { valid: false, reason: 'Choose at least one numeric variable.' }
  if (spec.splitBy && spec.yColumns.length !== 1) {
    return { valid: false, reason: 'Split charts support exactly one Y variable.' }
  }
  if (spec.yAxisScale === 'manual') {
    const min = Number(spec.yAxisMin)
    const max = Number(spec.yAxisMax)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      return { valid: false, reason: 'Manual Y scale requires a numeric min smaller than max.' }
    }
  }
  for (const line of spec.referenceLines) {
    if (line.value.trim() && !Number.isFinite(Number(line.value))) {
      return { valid: false, reason: 'Reference line values must be numeric.' }
    }
  }
  return { valid: true, reason: null }
}

function xExpression(spec: ChartSpec): string {
  const quoted = quoteIdent(spec.xColumn)
  if (spec.aggregation === 'none' || spec.bucket === 'none' || !spec.xColumnBucketable) return quoted
  return `date_trunc('${spec.bucket}', ${quoted})`
}

function aggregationExpression(aggregation: Exclude<ChartAggregation, 'none'>, column: string): string {
  const quoted = quoteIdent(column)
  if (aggregation === 'median') return `median(${quoted})`
  if (aggregation === 'stddev') return `stddev_samp(${quoted})`
  if (aggregation === 'p25') return `quantile_cont(${quoted}, 0.25)`
  if (aggregation === 'p75') return `quantile_cont(${quoted}, 0.75)`
  if (aggregation === 'count') return `count(${quoted})`
  if (aggregation === 'count_distinct') return `count(distinct ${quoted})`
  return `${aggregation}(${quoted})`
}

function filterValue(raw: string): string {
  const trimmed = raw.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return quoteLiteral(Number(trimmed))
  return quoteLiteral(trimmed)
}

function filterCondition(filter: ChartFilter): string | null {
  if (!filter.column) return null
  const col = quoteIdent(filter.column)
  const value = filter.value.trim()
  switch (filter.operator) {
    case 'is_null':
      return `${col} IS NULL`
    case 'is_not_null':
      return `${col} IS NOT NULL`
    case 'eq':
      return value ? `${col} = ${filterValue(value)}` : null
    case 'neq':
      return value ? `${col} <> ${filterValue(value)}` : null
    case 'gt':
      return value ? `${col} > ${filterValue(value)}` : null
    case 'gte':
      return value ? `${col} >= ${filterValue(value)}` : null
    case 'lt':
      return value ? `${col} < ${filterValue(value)}` : null
    case 'lte':
      return value ? `${col} <= ${filterValue(value)}` : null
    case 'contains':
      return value ? `contains(lower(cast(${col} AS VARCHAR)), lower(${quoteLiteral(value)}))` : null
    case 'starts_with':
      return value ? `starts_with(lower(cast(${col} AS VARCHAR)), lower(${quoteLiteral(value)}))` : null
    case 'in': {
      const parts = value.split(',').map((part) => part.trim()).filter(Boolean)
      return parts.length ? `${col} IN (${parts.map(filterValue).join(', ')})` : null
    }
    default:
      return null
  }
}

function whereClause(spec: ChartSpec): string {
  const conditions = [`${quoteIdent(spec.xColumn)} IS NOT NULL`]
  if (spec.splitBy) conditions.push(`${quoteIdent(spec.splitBy)} IS NOT NULL`)
  for (const filter of spec.filters) {
    const condition = filterCondition(filter)
    if (condition) conditions.push(condition)
  }
  return conditions.join(' AND ')
}

export function buildLineChartSql(spec: ChartSpec, viewName: string): string {
  const view = quoteIdent(viewName)
  const xExpr = xExpression(spec)
  const xAlias = quoteIdent('x')
  const where = whereClause(spec)
  const splitSelect = spec.splitBy ? `, ${quoteIdent(spec.splitBy)} AS ${quoteIdent('split')}` : ''
  const splitGroup = spec.splitBy ? ', 2' : ''
  const splitOrder = spec.splitBy ? `, ${quoteIdent('split')}` : ''

  if (spec.aggregation === 'none') {
    const selectCols = spec.yColumns.map((column) => quoteIdent(column)).join(', ')
    return formatAnalyticsSql(
      `SELECT ${xExpr} AS ${xAlias}${splitSelect}, ${selectCols} FROM ${view} WHERE ${where} ORDER BY ${xAlias}${splitOrder} LIMIT ${CHART_MAX_ROWS};`,
    )
  }

  const aggregation = spec.aggregation
  const measures = spec.splitBy
    ? `${aggregationExpression(aggregation, spec.yColumns[0] ?? spec.xColumn)} AS ${quoteIdent('value')}`
    : spec.yColumns
        .map((column) => `${aggregationExpression(aggregation, column)} AS ${quoteIdent(column)}`)
        .join(', ')
  return formatAnalyticsSql(
    `SELECT ${xExpr} AS ${xAlias}${splitSelect}, ${measures} FROM ${view} WHERE ${where} GROUP BY 1${splitGroup} ORDER BY ${xAlias}${splitOrder} LIMIT ${CHART_MAX_ROWS};`,
  )
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function normalizeX(value: unknown): string | number {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

export function queryResultToChartData(result: QueryResult | undefined, specOrColumns: ChartSpec | string[]): ChartDataPoint[] {
  if (!result?.rows.length || result.error) return []
  const spec = Array.isArray(specOrColumns) ? null : specOrColumns
  const yColumns = Array.isArray(specOrColumns) ? specOrColumns : specOrColumns.yColumns

  if (spec?.splitBy) {
    const byX = new Map<string | number, Record<string, number | null>>()
    for (const row of result.rows) {
      const x = normalizeX(row.x)
      const split = String(row.split ?? '(blank)')
      const values = byX.get(x) ?? {}
      values[split] = toNumberOrNull(row.value ?? row[yColumns[0] ?? 'value'])
      byX.set(x, values)
    }
    return [...byX.entries()].map(([x, values]) => ({ x, values }))
  }

  return result.rows.map((row) => {
    const values: Record<string, number | null> = {}
    for (const column of yColumns) values[column] = toNumberOrNull(row[column])
    return { x: normalizeX(row.x), values }
  })
}

function seriesNames(spec: ChartSpec, data: ChartDataPoint[]): string[] {
  if (!spec.splitBy) return spec.yColumns
  const names = new Set<string>()
  for (const point of data) {
    for (const name of Object.keys(point.values)) names.add(name)
  }
  return [...names]
}

function yAxisBounds(spec: ChartSpec): Record<string, number> {
  if (spec.yAxisScale === 'zero') return { min: 0 }
  if (spec.yAxisScale === 'manual') return { min: Number(spec.yAxisMin), max: Number(spec.yAxisMax) }
  return {}
}

function referenceMarkLine(spec: ChartSpec) {
  const lines = spec.referenceLines
    .filter((line) => line.value.trim() && Number.isFinite(Number(line.value)))
    .map((line) => ({
      name: line.label || line.value,
      yAxis: Number(line.value),
      label: { formatter: line.label || line.value },
    }))
  return lines.length ? { symbol: 'none', lineStyle: { type: 'dashed' }, data: lines } : undefined
}

export function buildLineChartOption(spec: ChartSpec, data: ChartDataPoint[]): EChartsCoreOption {
  const palette = chartPalette()
  const names = seriesNames(spec, data)
  const timeAxis = spec.xColumnTemporalKind === 'continuous_datetime'
  const markLine = referenceMarkLine(spec)
  return {
    color: palette,
    backgroundColor: 'transparent',
    title: spec.title
      ? {
          text: spec.title,
          left: 8,
          top: 0,
          textStyle: { color: hslFromRootVar('--fg'), fontSize: 14, fontWeight: 600 },
        }
      : undefined,
    grid: { left: 16, right: 24, top: spec.title ? 58 : 34, bottom: spec.showDataZoom ? 72 : 42, containLabel: true },
    legend: spec.showLegend
      ? {
          type: 'scroll',
          top: spec.title ? 28 : 0,
          right: 8,
          textStyle: { color: hslFromRootVar('--fg-muted'), fontSize: 11 },
        }
      : undefined,
    tooltip: {
      ...chartTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      valueFormatter: (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : String(value ?? ''),
    },
    dataZoom: spec.showDataZoom
      ? [
          { type: 'inside', xAxisIndex: 0 },
          { type: 'slider', xAxisIndex: 0, height: 18, bottom: 18 },
        ]
      : undefined,
    xAxis: {
      type: timeAxis ? 'time' : 'category',
      name: spec.xAxisLabel,
      nameLocation: 'middle',
      nameGap: 28,
      data: timeAxis ? undefined : data.map((point) => point.x),
      axisLabel: { ...chartAxisLabelStyle(), hideOverlap: true },
      axisLine: { lineStyle: { color: hslFromRootVar('--border-triple') } },
    },
    yAxis: {
      type: 'value',
      name: spec.yAxisLabel,
      nameLocation: 'middle',
      nameGap: 44,
      ...yAxisBounds(spec),
      axisLabel: chartAxisLabelStyle(),
      splitLine: { lineStyle: { color: hslFromRootVar('--border-triple', 0.4) } },
    },
    series: names.map((name, index) => ({
      name,
      type: 'line',
      data: timeAxis ? data.map((point) => [point.x, point.values[name]]) : data.map((point) => point.values[name]),
      smooth: spec.smooth,
      showSymbol: spec.showPoints,
      connectNulls: spec.connectNulls,
      lineStyle: { width: 2 },
      emphasis: { focus: 'series' },
      markLine: index === 0 ? markLine : undefined,
    })),
  }
}

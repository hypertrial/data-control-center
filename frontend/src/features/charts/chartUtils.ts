import type { EChartsCoreOption } from 'echarts'
import type { ColumnProfile, DatasetProfile, QueryResult, SemanticType } from '@/api/types'
import { chartAxisLabelStyle, chartPalette, chartTooltip, hslFromRootVar } from '@/lib/chartTheme'
import { formatAnalyticsSql, quoteIdent, quoteLiteral } from '@/lib/sql'

export const CHART_MAX_ROWS = 5000
export const CHART_SPEC_VERSION = 4
export const DEFAULT_HISTOGRAM_BINS = 12
export const DEFAULT_BAR_TOP_N = 25

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
export type ChartType = 'histogram' | 'line' | 'bar' | 'scatter'

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
  chartType: ChartType
  valueColumn: string
  valueColumnInteger: boolean
  binCount: number
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
  topN: number
}

export type ChartDataPoint = {
  x: string | number
  values: Record<string, number | null>
  lowerBound?: number | null
  upperBound?: number | null
}

export type ChartValidation = {
  valid: boolean
  reason: string | null
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names.filter(Boolean))]
}

/** Ascending locale order for column pickers in the Charts UI. */
export function sortColumnNamesAsc(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b))
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

function isIntegerPhysicalType(physicalType: string | undefined): boolean {
  return /\bU?Int(8|16|32|64)\b|BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT/i.test(physicalType ?? '')
}

export function getColumnIsInteger(profile: DatasetProfile | undefined, column: string): boolean {
  return isIntegerPhysicalType(columnProfile(profile, column)?.physical_type)
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

function getDefaultHistogramColumn(profile: DatasetProfile | undefined, numericColumns = getNumericColumnNames(profile)): string {
  return numericColumns.find((name) => (columnProfile(profile, name)?.histogram?.length ?? 0) > 0) ?? numericColumns[0] ?? ''
}

export function getSplitColumnNames(profile: DatasetProfile | undefined): string[] {
  if (!profile) return []
  return profile.column_profiles
    .filter((c) => ['categorical', 'boolean_like', 'id_like'].includes(c.semantic_type))
    .map((c) => c.name)
}

export function getCategoryColumnNames(profile: DatasetProfile | undefined): string[] {
  if (!profile) return []
  return profile.column_profiles
    .filter(
      (c) =>
        ['categorical', 'boolean_like', 'id_like'].includes(c.semantic_type) ||
        (c.semantic_type === 'text' && (c.cardinality ?? 999) <= 50),
    )
    .map((c) => c.name)
}

export function isCategoryColumn(profile: DatasetProfile | undefined, column: string): boolean {
  return column ? getCategoryColumnNames(profile).includes(column) : false
}

export function getDefaultCategoryColumn(profile: DatasetProfile | undefined): string {
  const names = getCategoryColumnNames(profile)
  const preferred = names.find((name) => {
    const cardinality = getColumnCardinality(profile, name)
    return cardinality != null && cardinality >= 2 && cardinality <= 50
  })
  return preferred ?? names[0] ?? ''
}

export function getDefaultScatterColumns(profile: DatasetProfile | undefined): { x: string; y: string } {
  const numeric = getNumericColumnNames(profile)
  return { x: numeric[0] ?? '', y: numeric[1] ?? numeric[0] ?? '' }
}

function isBarCountOnly(spec: ChartSpec): boolean {
  return spec.aggregation === 'count' && !spec.yColumns[0]
}

export function getFilterColumnNames(profile: DatasetProfile | undefined): string[] {
  if (!profile) return []
  return profile.column_profiles.map((c) => c.name)
}

export function getColumnCardinality(profile: DatasetProfile | undefined, column: string): number | null {
  return columnProfile(profile, column)?.cardinality ?? null
}

function buildChartSpec(
  datasetId: string,
  profile: DatasetProfile | undefined,
  chartType: ChartType,
  partial: Partial<ChartSpec> = {},
): ChartSpec {
  const temporalX = getTemporalColumnNames(profile)[0] ?? ''
  const numericColumns = getNumericColumnNames(profile)
  const categoryColumn = getDefaultCategoryColumn(profile)
  const scatterColumns = getDefaultScatterColumns(profile)
  const valueColumn = getDefaultHistogramColumn(profile, numericColumns)
  const lineX = temporalX
  const lineYColumns = numericColumns.filter((name) => name !== lineX).slice(0, 3)
  const lineBucketable = isBucketableTemporalColumn(profile, lineX)
  const barMeasure = numericColumns[0] ?? ''
  const barCountOnly = !barMeasure

  const xColumn =
    chartType === 'bar'
      ? categoryColumn
      : chartType === 'scatter'
        ? scatterColumns.x
        : chartType === 'histogram'
          ? temporalX
          : lineX
  const yColumns =
    chartType === 'scatter'
      ? scatterColumns.y ? [scatterColumns.y] : []
      : chartType === 'bar'
        ? barCountOnly
          ? []
          : [barMeasure]
        : chartType === 'histogram'
          ? lineYColumns
          : lineYColumns
  const xColumnBucketable = chartType === 'line' ? lineBucketable : false
  const xColumnTemporalKind = chartType === 'line' ? getTemporalKind(profile, lineX) : null

  return {
    version: CHART_SPEC_VERSION,
    datasetId,
    chartType,
    valueColumn,
    valueColumnInteger: getColumnIsInteger(profile, valueColumn),
    binCount: DEFAULT_HISTOGRAM_BINS,
    xColumn,
    xColumnBucketable,
    xColumnTemporalKind,
    yColumns,
    aggregation:
      chartType === 'bar'
        ? barCountOnly
          ? 'count'
          : 'sum'
        : chartType === 'scatter'
          ? 'none'
          : 'avg',
    bucket: chartType === 'line' && lineBucketable ? 'month' : 'none',
    filters: [],
    splitBy: '',
    topN: DEFAULT_BAR_TOP_N,
    yAxisScale: chartType === 'histogram' || chartType === 'bar' ? 'zero' : 'auto',
    yAxisMin: '',
    yAxisMax: '',
    referenceLines: [],
    showDataZoom: chartType !== 'scatter',
    title:
      chartType === 'histogram'
        ? valueColumn
          ? `${valueColumn} distribution`
          : 'Dataset distribution'
        : chartType === 'bar'
          ? categoryColumn
            ? barCountOnly
              ? `${categoryColumn} by count`
              : `${categoryColumn} by ${barMeasure}`
            : 'Category comparison'
          : chartType === 'scatter'
            ? scatterColumns.x && scatterColumns.y
              ? `${scatterColumns.y} vs ${scatterColumns.x}`
              : 'Scatter plot'
            : profile?.name
              ? `${profile.name} trends`
              : 'Dataset trends',
    showLegend: true,
    smooth: false,
    showPoints: false,
    connectNulls: false,
    xAxisLabel:
      chartType === 'histogram'
        ? valueColumn
        : chartType === 'bar'
          ? categoryColumn
          : chartType === 'scatter'
            ? scatterColumns.x
            : lineX,
    yAxisLabel:
      chartType === 'histogram' || (chartType === 'bar' && barCountOnly)
        ? 'Count'
        : chartType === 'scatter'
          ? scatterColumns.y
          : '',
    ...partial,
  }
}

export function createDefaultChartSpec(datasetId: string, profile: DatasetProfile | undefined): ChartSpec {
  const numericColumns = getNumericColumnNames(profile)
  const valueColumn = getDefaultHistogramColumn(profile, numericColumns)
  const categoryColumn = getDefaultCategoryColumn(profile)
  const temporalX = getTemporalColumnNames(profile)[0] ?? ''
  const scatterColumns = getDefaultScatterColumns(profile)

  let chartType: ChartType = 'line'
  if (valueColumn) chartType = 'histogram'
  else if (categoryColumn) chartType = 'bar'
  else if (temporalX) chartType = 'line'
  else if (scatterColumns.x && scatterColumns.y && scatterColumns.x !== scatterColumns.y) chartType = 'scatter'

  return buildChartSpec(datasetId, profile, chartType)
}

function parseChartType(raw: Partial<ChartSpec>, rawVersion: number, base: ChartSpec): ChartType {
  if (raw.chartType === 'histogram' || raw.chartType === 'line' || raw.chartType === 'bar' || raw.chartType === 'scatter') {
    return raw.chartType
  }
  if (rawVersion < 3) return 'line'
  return base.chartType
}

export function normalizeChartSpec(
  raw: Partial<ChartSpec> | undefined,
  datasetId: string,
  profile: DatasetProfile | undefined,
): ChartSpec {
  const base = createDefaultChartSpec(datasetId, profile)
  if (!raw || typeof raw !== 'object') return base
  const rawVersion = typeof raw.version === 'number' ? raw.version : 2
  const chartType = parseChartType(raw, rawVersion, base)
  const normalizedBase = buildChartSpec(datasetId, profile, chartType)
  const yColumns = uniqueNames(Array.isArray(raw.yColumns) ? raw.yColumns : normalizedBase.yColumns)
  const splitBy = typeof raw.splitBy === 'string' ? raw.splitBy : ''
  const xColumn = typeof raw.xColumn === 'string' ? raw.xColumn : normalizedBase.xColumn
  const valueColumn = typeof raw.valueColumn === 'string'
    ? raw.valueColumn
    : chartType === 'histogram'
      ? getDefaultHistogramColumn(profile)
      : normalizedBase.valueColumn
  const binCount = Number(raw.binCount)
  const topN = Number(raw.topN)
  const valueColumnInteger = typeof raw.valueColumnInteger === 'boolean'
    ? raw.valueColumnInteger
    : getColumnIsInteger(profile, valueColumn)
  const limitedYColumns =
    splitBy && yColumns.length > 1 && chartType !== 'histogram' ? yColumns.slice(0, 1) : yColumns

  const spec: ChartSpec = {
    ...normalizedBase,
    ...raw,
    version: CHART_SPEC_VERSION,
    datasetId,
    chartType,
    valueColumn,
    valueColumnInteger,
    binCount: Number.isInteger(binCount) && binCount > 0 ? Math.min(binCount, 100) : DEFAULT_HISTOGRAM_BINS,
    topN: Number.isInteger(topN) && topN > 0 ? Math.min(topN, 100) : DEFAULT_BAR_TOP_N,
    yColumns: limitedYColumns,
    filters: Array.isArray(raw.filters) ? raw.filters : [],
    referenceLines: Array.isArray(raw.referenceLines) ? raw.referenceLines : [],
    splitBy,
    xColumn,
    xColumnBucketable: chartType === 'line' ? isBucketableTemporalColumn(profile, xColumn) : false,
    xColumnTemporalKind: chartType === 'line' ? getTemporalKind(profile, xColumn) : null,
  }

  if (chartType === 'scatter') {
    spec.aggregation = 'none'
    spec.bucket = 'none'
    spec.referenceLines = []
    spec.smooth = false
    spec.showPoints = false
    spec.connectNulls = false
    if (splitBy && spec.yColumns.length > 1) spec.yColumns = spec.yColumns.slice(0, 1)
  }

  if (chartType === 'bar' && spec.aggregation === 'count' && !spec.yColumns[0]) {
    spec.yColumns = []
  }

  return spec
}

function validateManualYScale(spec: ChartSpec): ChartValidation {
  if (spec.yAxisScale !== 'manual') return { valid: true, reason: null }
  const min = Number(spec.yAxisMin)
  const max = Number(spec.yAxisMax)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return { valid: false, reason: 'Manual Y scale requires a numeric min smaller than max.' }
  }
  return { valid: true, reason: null }
}

export function validateChartSpec(
  spec: ChartSpec,
  viewName: string | undefined,
  profile?: DatasetProfile,
): ChartValidation {
  if (!spec.datasetId || !viewName) return { valid: false, reason: 'Select a dataset to build a chart.' }

  if (spec.chartType === 'histogram') {
    if (!spec.valueColumn) return { valid: false, reason: 'Choose a numeric variable for the histogram.' }
    if (!Number.isInteger(spec.binCount) || spec.binCount < 1 || spec.binCount > 100) {
      return { valid: false, reason: 'Histogram bins must be an integer from 1 to 100.' }
    }
    return validateManualYScale(spec)
  }

  if (spec.chartType === 'bar') {
    if (!spec.xColumn) return { valid: false, reason: 'Choose a category column for the bar chart.' }
    if (profile && !isCategoryColumn(profile, spec.xColumn)) {
      return { valid: false, reason: 'Bar charts require a categorical column on the X axis.' }
    }
    if (!isBarCountOnly(spec) && !spec.yColumns[0]) {
      return { valid: false, reason: 'Choose a numeric measure or use Count aggregation.' }
    }
    if (spec.aggregation === 'none') {
      return { valid: false, reason: 'Choose an aggregation for the bar chart.' }
    }
    if (!Number.isInteger(spec.topN) || spec.topN < 1 || spec.topN > 100) {
      return { valid: false, reason: 'Top N must be an integer from 1 to 100.' }
    }
    if (spec.splitBy && !isBarCountOnly(spec) && spec.yColumns.length !== 1) {
      return { valid: false, reason: 'Split bar charts support exactly one measure.' }
    }
    return validateManualYScale(spec)
  }

  if (spec.chartType === 'scatter') {
    if (!spec.xColumn || !spec.yColumns[0]) {
      return { valid: false, reason: 'Choose numeric X and Y variables for the scatter plot.' }
    }
    if (spec.xColumn === spec.yColumns[0]) {
      return { valid: false, reason: 'Scatter plots require two different numeric columns.' }
    }
    if (profile) {
      const numeric = getNumericColumnNames(profile)
      if (!numeric.includes(spec.xColumn) || !numeric.includes(spec.yColumns[0])) {
        return { valid: false, reason: 'Scatter plots require numeric columns for X and Y.' }
      }
    }
    if (spec.splitBy && spec.yColumns.length !== 1) {
      return { valid: false, reason: 'Split scatter plots support exactly one Y variable.' }
    }
    return validateManualYScale(spec)
  }

  if (!spec.xColumn) return { valid: false, reason: 'Choose a temporal column for the X axis.' }
  if (!spec.yColumns.length) return { valid: false, reason: 'Choose at least one numeric variable.' }
  if (spec.splitBy && spec.yColumns.length !== 1) {
    return { valid: false, reason: 'Split charts support exactly one Y variable.' }
  }
  const manual = validateManualYScale(spec)
  if (!manual.valid) return manual
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

function whereClause(spec: ChartSpec, requiredColumn = spec.xColumn, extraRequired?: string): string {
  const conditions: string[] = []
  if (requiredColumn) conditions.push(`${quoteIdent(requiredColumn)} IS NOT NULL`)
  if (extraRequired) conditions.push(`${quoteIdent(extraRequired)} IS NOT NULL`)
  if (spec.splitBy) conditions.push(`${quoteIdent(spec.splitBy)} IS NOT NULL`)
  for (const filter of spec.filters) {
    const condition = filterCondition(filter)
    if (condition) conditions.push(condition)
  }
  return conditions.length ? conditions.join(' AND ') : 'TRUE'
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

export function buildHistogramChartSql(spec: ChartSpec, viewName: string): string {
  if (spec.valueColumnInteger) return buildIntegerHistogramChartSql(spec, viewName)

  const view = quoteIdent(viewName)
  const value = quoteIdent(spec.valueColumn)
  const split = spec.splitBy ? quoteIdent(spec.splitBy) : ''
  const binCount = Math.min(Math.max(Math.trunc(spec.binCount || DEFAULT_HISTOGRAM_BINS), 1), 100)
  const lastBin = binCount - 1
  const where = whereClause(spec, spec.valueColumn)
  const splitProjection = spec.splitBy ? `, CAST(${split} AS VARCHAR) AS ${quoteIdent('split')}` : ''
  const splitGroup = spec.splitBy ? ', 2' : ''
  const splitValues = spec.splitBy
    ? `, _dcc_split_values AS (SELECT DISTINCT CAST(${split} AS VARCHAR) AS ${quoteIdent('split')} FROM ${view} WHERE ${where})`
    : ''
  const splitJoin = spec.splitBy
    ? ` CROSS JOIN _dcc_split_values LEFT JOIN _dcc_counts ON _dcc_counts.bin_index = _dcc_bins.bin_index AND _dcc_counts.${quoteIdent('split')} = _dcc_split_values.${quoteIdent('split')}`
    : ' LEFT JOIN _dcc_counts ON _dcc_counts.bin_index = _dcc_bins.bin_index'
  const splitSelect = spec.splitBy ? `, _dcc_split_values.${quoteIdent('split')} AS ${quoteIdent('split')}` : ''
  const splitOrder = spec.splitBy ? `, ${quoteIdent('split')}` : ''

  return formatAnalyticsSql(
    `WITH _dcc_stats AS (
      SELECT min(${value}) AS min_v, max(${value}) AS max_v
      FROM ${view}
      WHERE ${where}
    ),
    _dcc_bins AS (
      SELECT range::INTEGER AS bin_index
      FROM range(${binCount})
    )${splitValues},
    _dcc_counts AS (
      SELECT
        CASE
          WHEN _dcc_stats.min_v = _dcc_stats.max_v THEN 0
          ELSE least(${lastBin}, greatest(0, CAST(floor(((${value} - _dcc_stats.min_v) / nullif(_dcc_stats.max_v - _dcc_stats.min_v, 0)) * ${binCount}) AS INTEGER)))
        END AS bin_index${splitProjection},
        count(*) AS ${quoteIdent('count')}
      FROM ${view}
      CROSS JOIN _dcc_stats
      WHERE ${where}
      GROUP BY 1${splitGroup}
    )
    SELECT
      _dcc_bins.bin_index,
      CASE
        WHEN _dcc_stats.min_v = _dcc_stats.max_v THEN _dcc_stats.min_v
        ELSE _dcc_stats.min_v + ((_dcc_stats.max_v - _dcc_stats.min_v) / ${binCount}) * _dcc_bins.bin_index
      END AS lower_bound,
      CASE
        WHEN _dcc_stats.min_v = _dcc_stats.max_v THEN _dcc_stats.max_v
        ELSE _dcc_stats.min_v + ((_dcc_stats.max_v - _dcc_stats.min_v) / ${binCount}) * (_dcc_bins.bin_index + 1)
      END AS upper_bound${splitSelect},
      coalesce(_dcc_counts.${quoteIdent('count')}, 0) AS ${quoteIdent('count')}
    FROM _dcc_stats
    CROSS JOIN _dcc_bins${splitJoin}
    WHERE _dcc_stats.min_v IS NOT NULL
      AND (_dcc_stats.min_v <> _dcc_stats.max_v OR _dcc_bins.bin_index = 0)
    ORDER BY _dcc_bins.bin_index${splitOrder}
    LIMIT ${CHART_MAX_ROWS};`,
  )
}

function buildIntegerHistogramChartSql(spec: ChartSpec, viewName: string): string {
  const view = quoteIdent(viewName)
  const value = quoteIdent(spec.valueColumn)
  const split = spec.splitBy ? quoteIdent(spec.splitBy) : ''
  const binCount = Math.min(Math.max(Math.trunc(spec.binCount || DEFAULT_HISTOGRAM_BINS), 1), 100)
  const where = whereClause(spec, spec.valueColumn)
  const splitProjection = spec.splitBy ? `, CAST(${split} AS VARCHAR) AS ${quoteIdent('split')}` : ''
  const splitGroup = spec.splitBy ? ', 2' : ''
  const splitValues = spec.splitBy
    ? `, _dcc_split_values AS (SELECT DISTINCT CAST(${split} AS VARCHAR) AS ${quoteIdent('split')} FROM ${view} WHERE ${where})`
    : ''
  const splitJoin = spec.splitBy
    ? ` CROSS JOIN _dcc_split_values LEFT JOIN _dcc_counts ON _dcc_counts.bin_index = _dcc_ranges.bin_index AND _dcc_counts.${quoteIdent('split')} = _dcc_split_values.${quoteIdent('split')}`
    : ' LEFT JOIN _dcc_counts ON _dcc_counts.bin_index = _dcc_ranges.bin_index'
  const splitSelect = spec.splitBy ? `, _dcc_split_values.${quoteIdent('split')} AS ${quoteIdent('split')}` : ''
  const splitOrder = spec.splitBy ? `, ${quoteIdent('split')}` : ''

  return formatAnalyticsSql(
    `WITH _dcc_stats AS (
      SELECT CAST(min(${value}) AS BIGINT) AS min_v, CAST(max(${value}) AS BIGINT) AS max_v
      FROM ${view}
      WHERE ${where}
    ),
    _dcc_shape AS (
      SELECT
        min_v,
        max_v,
        max_v - min_v + 1 AS domain_size,
        least(${binCount}, max_v - min_v + 1) AS bucket_count,
        CAST(floor((max_v - min_v + 1)::DOUBLE / least(${binCount}, max_v - min_v + 1)) AS BIGINT) AS base_width,
        (max_v - min_v + 1) % least(${binCount}, max_v - min_v + 1) AS extra_bins
      FROM _dcc_stats
      WHERE min_v IS NOT NULL
    ),
    _dcc_ranges AS (
      SELECT
        range::INTEGER AS bin_index,
        min_v + range * base_width + least(range, extra_bins) AS lower_bound,
        min_v + range * base_width + least(range, extra_bins) + base_width + CASE WHEN extra_bins > range THEN 1 ELSE 0 END - 1 AS upper_bound
      FROM _dcc_shape, range(bucket_count)
    )${splitValues},
    _dcc_counts AS (
      SELECT
        _dcc_ranges.bin_index${splitProjection},
        count(*) AS ${quoteIdent('count')}
      FROM ${view}
      CROSS JOIN _dcc_ranges
      WHERE ${where}
        AND CAST(${value} AS BIGINT) BETWEEN _dcc_ranges.lower_bound AND _dcc_ranges.upper_bound
      GROUP BY 1${splitGroup}
    )
    SELECT
      _dcc_ranges.bin_index,
      _dcc_ranges.lower_bound,
      _dcc_ranges.upper_bound${splitSelect},
      coalesce(_dcc_counts.${quoteIdent('count')}, 0) AS ${quoteIdent('count')}
    FROM _dcc_ranges${splitJoin}
    ORDER BY _dcc_ranges.bin_index${splitOrder}
    LIMIT ${CHART_MAX_ROWS};`,
  )
}

export function buildBarChartSql(spec: ChartSpec, viewName: string): string {
  const view = quoteIdent(viewName)
  const category = quoteIdent(spec.xColumn)
  const xAlias = quoteIdent('x')
  const topN = Math.min(Math.max(Math.trunc(spec.topN || DEFAULT_BAR_TOP_N), 1), 100)
  const countOnly = isBarCountOnly(spec)
  const measureColumn = spec.yColumns[0]
  const extraRequired = countOnly ? undefined : measureColumn
  const where = whereClause(spec, spec.xColumn, extraRequired)
  const splitSelect = spec.splitBy ? `, CAST(${quoteIdent(spec.splitBy)} AS VARCHAR) AS ${quoteIdent('split')}` : ''
  const splitGroup = spec.splitBy ? ', 2' : ''
  const splitOrder = spec.splitBy ? `, ${quoteIdent('split')}` : ''

  const rankMeasure = countOnly
    ? 'count(*)'
    : aggregationExpression(spec.aggregation as Exclude<ChartAggregation, 'none'>, measureColumn)

  const rankedCte = `WITH _dcc_bar_ranked AS (
  SELECT CAST(${category} AS VARCHAR) AS ${xAlias}, ${rankMeasure} AS ${quoteIdent('sort_value')}
  FROM ${view}
  WHERE ${where}
  GROUP BY 1
  ORDER BY ${quoteIdent('sort_value')} DESC
  LIMIT ${topN}
)`

  const detailMeasure = countOnly
    ? `count(*) AS ${quoteIdent('count')}`
    : spec.splitBy
      ? `${aggregationExpression(spec.aggregation as Exclude<ChartAggregation, 'none'>, measureColumn)} AS ${quoteIdent('value')}`
      : `${aggregationExpression(spec.aggregation as Exclude<ChartAggregation, 'none'>, measureColumn)} AS ${quoteIdent(measureColumn)}`

  if (spec.splitBy) {
    return formatAnalyticsSql(
      `${rankedCte}
SELECT CAST(${category} AS VARCHAR) AS ${xAlias}${splitSelect}, ${detailMeasure}
FROM ${view}
INNER JOIN _dcc_bar_ranked ON CAST(${category} AS VARCHAR) = _dcc_bar_ranked.${xAlias}
WHERE ${where}
GROUP BY 1${splitGroup}
ORDER BY max(_dcc_bar_ranked.${quoteIdent('sort_value')}) DESC, ${xAlias}${splitOrder};`,
    )
  }

  return formatAnalyticsSql(
    `${rankedCte}
SELECT CAST(${category} AS VARCHAR) AS ${xAlias}, ${detailMeasure}
FROM ${view}
INNER JOIN _dcc_bar_ranked ON CAST(${category} AS VARCHAR) = _dcc_bar_ranked.${xAlias}
WHERE ${where}
GROUP BY 1
ORDER BY max(_dcc_bar_ranked.${quoteIdent('sort_value')}) DESC;`,
  )
}

export function buildScatterChartSql(spec: ChartSpec, viewName: string): string {
  const view = quoteIdent(viewName)
  const xCol = quoteIdent(spec.xColumn)
  const yCol = quoteIdent(spec.yColumns[0] ?? '')
  const xAlias = quoteIdent('x')
  const yAlias = quoteIdent('y')
  const where = whereClause(spec, spec.xColumn, spec.yColumns[0])
  const splitSelect = spec.splitBy ? `, CAST(${quoteIdent(spec.splitBy)} AS VARCHAR) AS ${quoteIdent('split')}` : ''
  const splitOrder = spec.splitBy ? `, ${quoteIdent('split')}` : ''

  return formatAnalyticsSql(
    `SELECT ${xCol} AS ${xAlias}, ${yCol} AS ${yAlias}${splitSelect} FROM ${view} WHERE ${where} ORDER BY ${xAlias}${splitOrder} LIMIT ${CHART_MAX_ROWS};`,
  )
}

export function buildChartSql(spec: ChartSpec, viewName: string): string {
  switch (spec.chartType) {
    case 'histogram':
      return buildHistogramChartSql(spec, viewName)
    case 'bar':
      return buildBarChartSql(spec, viewName)
    case 'scatter':
      return buildScatterChartSql(spec, viewName)
    default:
      return buildLineChartSql(spec, viewName)
  }
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

function formatBinValue(value: number | null): string {
  if (value == null) return ''
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function histogramBinLabel(lower: number | null, upper: number | null): string {
  if (lower != null && upper != null && lower === upper) return formatBinValue(lower)
  return `${formatBinValue(lower)} - ${formatBinValue(upper)}`
}

function queryResultToHistogramData(result: QueryResult | undefined, spec: ChartSpec): ChartDataPoint[] {
  if (!result?.rows.length || result.error) return []

  if (spec.splitBy) {
    const byBin = new Map<string, ChartDataPoint>()
    for (const row of result.rows) {
      const lowerBound = toNumberOrNull(row.lower_bound)
      const upperBound = toNumberOrNull(row.upper_bound)
      const x = histogramBinLabel(lowerBound, upperBound)
      const split = String(row.split ?? '(blank)')
      const point = byBin.get(x) ?? { x, values: {}, lowerBound, upperBound }
      point.values[split] = toNumberOrNull(row.count) ?? 0
      byBin.set(x, point)
    }
    return [...byBin.values()]
  }

  return result.rows.map((row) => {
    const lowerBound = toNumberOrNull(row.lower_bound)
    const upperBound = toNumberOrNull(row.upper_bound)
    return {
      x: histogramBinLabel(lowerBound, upperBound),
      lowerBound,
      upperBound,
      values: { Count: toNumberOrNull(row.count) ?? 0 },
    }
  })
}

function barValueFromRow(row: Record<string, unknown>, spec: ChartSpec, yColumns: string[]): number | null {
  if (isBarCountOnly(spec)) return toNumberOrNull(row.count)
  return toNumberOrNull(row.value ?? row[yColumns[0] ?? 'value'])
}

function queryResultToBarData(result: QueryResult | undefined, spec: ChartSpec): ChartDataPoint[] {
  if (!result?.rows.length || result.error) return []
  const yColumns = spec.yColumns
  const seriesKey = isBarCountOnly(spec) ? 'Count' : yColumns[0] ?? 'value'

  if (spec.splitBy) {
    const byX = new Map<string | number, Record<string, number | null>>()
    for (const row of result.rows) {
      const x = normalizeX(row.x)
      const split = String(row.split ?? '(blank)')
      const values = byX.get(x) ?? {}
      values[split] = barValueFromRow(row, spec, yColumns)
      byX.set(x, values)
    }
    return [...byX.entries()].map(([x, values]) => ({ x, values }))
  }

  return result.rows.map((row) => ({
    x: normalizeX(row.x),
    values: { [seriesKey]: barValueFromRow(row, spec, yColumns) },
  }))
}

function queryResultToScatterData(result: QueryResult | undefined, spec: ChartSpec): ChartDataPoint[] {
  if (!result?.rows.length || result.error) return []
  const yColumn = spec.yColumns[0] ?? 'y'

  const points: ChartDataPoint[] = []
  if (spec.splitBy) {
    for (const row of result.rows) {
      const x = toNumberOrNull(row.x)
      if (x == null) continue
      const split = String(row.split ?? '(blank)')
      points.push({ x, values: { [split]: toNumberOrNull(row.y ?? row[yColumn]) } })
    }
    return points
  }

  for (const row of result.rows) {
    const x = toNumberOrNull(row.x)
    const y = toNumberOrNull(row.y ?? row[yColumn])
    if (x == null || y == null) continue
    points.push({ x, values: { [yColumn]: y } })
  }
  return points
}

export function queryResultToChartData(result: QueryResult | undefined, specOrColumns: ChartSpec | string[]): ChartDataPoint[] {
  if (!result?.rows.length || result.error) return []
  const spec = Array.isArray(specOrColumns) ? null : specOrColumns
  if (spec?.chartType === 'histogram') return queryResultToHistogramData(result, spec)
  if (spec?.chartType === 'bar') return queryResultToBarData(result, spec)
  if (spec?.chartType === 'scatter') return queryResultToScatterData(result, spec)
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
  if (spec.chartType === 'bar' && isBarCountOnly(spec) && !spec.splitBy) return ['Count']
  if (spec.chartType === 'bar' && !spec.splitBy) return spec.yColumns.length ? spec.yColumns : ['Count']
  if (spec.chartType === 'scatter' && !spec.splitBy) return spec.yColumns.length ? spec.yColumns : ['y']
  if (!spec.splitBy) return spec.yColumns
  const names = new Set<string>()
  for (const point of data) {
    for (const name of Object.keys(point.values)) names.add(name)
  }
  return [...names]
}

function yAxisBounds(spec: ChartSpec): Record<string, number | boolean> {
  if (spec.yAxisScale === 'zero') return { min: 0, scale: false }
  if (spec.yAxisScale === 'manual') return { min: Number(spec.yAxisMin), max: Number(spec.yAxisMax), scale: true }
  return { scale: true }
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

function histogramSeriesNames(spec: ChartSpec, data: ChartDataPoint[]): string[] {
  if (!spec.splitBy) return ['Count']
  const names = new Set<string>()
  for (const point of data) {
    for (const name of Object.keys(point.values)) names.add(name)
  }
  return [...names]
}

function histogramTooltipFormatter(params: unknown): string {
  const items = Array.isArray(params) ? params : [params]
  const first = items[0] as { axisValueLabel?: string; name?: string; dataIndex?: number } | undefined
  const label = first?.axisValueLabel ?? first?.name ?? ''
  const rows = items
    .map((item) => {
      const param = item as { marker?: string; seriesName?: string; value?: unknown }
      const value = typeof param.value === 'number' && Number.isFinite(param.value)
        ? param.value.toLocaleString()
        : String(param.value ?? '')
      return `${param.marker ?? ''}${param.seriesName ?? 'Count'}: ${value}`
    })
    .join('<br/>')
  return label ? `${label}<br/>${rows}` : rows
}

export function buildHistogramChartOption(spec: ChartSpec, data: ChartDataPoint[]): EChartsCoreOption {
  const names = histogramSeriesNames(spec, data)
  return {
    color: chartPalette(),
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
    legend: spec.showLegend && spec.splitBy
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
      axisPointer: { type: 'shadow' },
      formatter: histogramTooltipFormatter,
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
      type: 'category',
      name: spec.xAxisLabel,
      nameLocation: 'middle',
      nameGap: 36,
      data: data.map((point) => point.x),
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
    series: names.map((name) => ({
      name,
      type: 'bar',
      data: data.map((point) => point.values[name] ?? 0),
      barGap: spec.splitBy ? '10%' : '0%',
      barCategoryGap: spec.splitBy ? '20%' : '0%',
      emphasis: { focus: 'series' },
    })),
  }
}

function categoryBarTooltipFormatter(params: unknown): string {
  const items = Array.isArray(params) ? params : [params]
  const first = items[0] as { axisValueLabel?: string; name?: string } | undefined
  const label = first?.axisValueLabel ?? first?.name ?? ''
  const rows = items
    .map((item) => {
      const param = item as { marker?: string; seriesName?: string; value?: unknown }
      const value = typeof param.value === 'number' && Number.isFinite(param.value)
        ? param.value.toLocaleString()
        : String(param.value ?? '')
      return `${param.marker ?? ''}${param.seriesName ?? ''}: ${value}`
    })
    .join('<br/>')
  return label ? `${label}<br/>${rows}` : rows
}

export function buildBarChartOption(spec: ChartSpec, data: ChartDataPoint[]): EChartsCoreOption {
  const names = seriesNames(spec, data)
  return {
    color: chartPalette(),
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
    legend: spec.showLegend && (spec.splitBy || names.length > 1)
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
      axisPointer: { type: 'shadow' },
      formatter: categoryBarTooltipFormatter,
    },
    dataZoom: spec.showDataZoom
      ? [
          { type: 'inside', xAxisIndex: 0 },
          { type: 'slider', xAxisIndex: 0, height: 18, bottom: 18 },
        ]
      : undefined,
    xAxis: {
      type: 'category',
      name: spec.xAxisLabel,
      nameLocation: 'middle',
      nameGap: 36,
      data: data.map((point) => point.x),
      axisLabel: { ...chartAxisLabelStyle(), hideOverlap: true, rotate: data.length > 12 ? 35 : 0 },
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
    series: names.map((name) => ({
      name,
      type: 'bar',
      data: data.map((point) => point.values[name] ?? 0),
      barGap: spec.splitBy ? '10%' : '0%',
      barCategoryGap: spec.splitBy ? '20%' : '0%',
      emphasis: { focus: 'series' },
    })),
  }
}

export function buildScatterChartOption(spec: ChartSpec, data: ChartDataPoint[]): EChartsCoreOption {
  const names = seriesNames(spec, data)
  const pointOpacity = data.length > 800 ? 0.35 : data.length > 200 ? 0.55 : 0.85
  return {
    color: chartPalette(),
    backgroundColor: 'transparent',
    title: spec.title
      ? {
          text: spec.title,
          left: 8,
          top: 0,
          textStyle: { color: hslFromRootVar('--fg'), fontSize: 14, fontWeight: 600 },
        }
      : undefined,
    grid: { left: 16, right: 24, top: spec.title ? 58 : 34, bottom: 42, containLabel: true },
    legend: spec.showLegend && spec.splitBy
      ? {
          type: 'scroll',
          top: spec.title ? 28 : 0,
          right: 8,
          textStyle: { color: hslFromRootVar('--fg-muted'), fontSize: 11 },
        }
      : undefined,
    tooltip: {
      ...chartTooltip(),
      trigger: 'item',
      valueFormatter: (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : String(value ?? ''),
    },
    dataZoom: spec.showDataZoom ? [{ type: 'inside', xAxisIndex: 0, yAxisIndex: 0 }] : undefined,
    xAxis: {
      type: 'value',
      name: spec.xAxisLabel,
      nameLocation: 'middle',
      nameGap: 28,
      scale: true,
      axisLabel: chartAxisLabelStyle(),
      axisLine: { lineStyle: { color: hslFromRootVar('--border-triple') } },
      splitLine: { lineStyle: { color: hslFromRootVar('--border-triple', 0.4) } },
    },
    yAxis: {
      type: 'value',
      name: spec.yAxisLabel,
      nameLocation: 'middle',
      nameGap: 44,
      scale: true,
      ...yAxisBounds(spec),
      axisLabel: chartAxisLabelStyle(),
      splitLine: { lineStyle: { color: hslFromRootVar('--border-triple', 0.4) } },
    },
    series: names.map((name) => ({
      name,
      type: 'scatter',
      symbolSize: 7,
      itemStyle: { opacity: pointOpacity },
      emphasis: { focus: 'series' },
      data: data
        .filter((point) => point.values[name] != null)
        .map((point) => [point.x, point.values[name]] as [number, number]),
    })),
  }
}

export function buildChartOption(spec: ChartSpec, data: ChartDataPoint[]): EChartsCoreOption {
  switch (spec.chartType) {
    case 'histogram':
      return buildHistogramChartOption(spec, data)
    case 'bar':
      return buildBarChartOption(spec, data)
    case 'scatter':
      return buildScatterChartOption(spec, data)
    default:
      return buildLineChartOption(spec, data)
  }
}

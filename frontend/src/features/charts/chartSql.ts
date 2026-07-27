import { formatAnalyticsSql, quoteIdent, quoteLiteral } from '@/lib/sql'
import {
  CHART_MAX_ROWS,
  DEFAULT_BAR_TOP_N,
  DEFAULT_HISTOGRAM_BINS,
  isBarCountOnly,
  type ChartAggregation,
  type ChartFilter,
  type ChartSpec,
} from '@/features/charts/chartSpec'

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
  const n = Number(trimmed)
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && Number.isFinite(n) && String(n) === trimmed) {
    return quoteLiteral(n)
  }
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

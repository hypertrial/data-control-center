import { describe, expect, it } from 'vitest'
import type { QueryResult } from '@/api/types'
import { mkColumn, mkProfile } from '@/test/profileFixtures'
import {
  buildChartSql,
  buildHistogramChartOption,
  buildHistogramChartSql,
  buildLineChartOption,
  buildLineChartSql,
  createDefaultChartSpec,
  getNumericColumnNames,
  getTemporalColumnNames,
  normalizeChartSpec,
  queryResultToChartData,
  validateChartSpec,
  type ChartSpec,
} from '@/features/charts/chartUtils'

function baseSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    version: 3,
    datasetId: 'ds_001',
    chartType: 'line',
    valueColumn: 'gross revenue',
    valueColumnInteger: false,
    binCount: 12,
    xColumn: 'order date',
    xColumnBucketable: true,
    xColumnTemporalKind: 'continuous_datetime',
    yColumns: ['gross revenue', 'profit'],
    aggregation: 'avg',
    bucket: 'month',
    filters: [],
    splitBy: '',
    yAxisScale: 'auto',
    yAxisMin: '',
    yAxisMax: '',
    referenceLines: [],
    showDataZoom: true,
    title: 'Trends',
    showLegend: true,
    smooth: false,
    showPoints: false,
    connectNulls: false,
    xAxisLabel: 'order date',
    yAxisLabel: '',
    ...overrides,
  }
}

describe('chartUtils', () => {
  it('selects histogram defaults from profile metadata', () => {
    const profile = mkProfile({
      name: 'Orders',
      primary_temporal_column: { name: 'order_date', kind: 'continuous_datetime', confidence: 'high' },
      temporal_columns: [{ name: 'created_at', kind: 'continuous_datetime', confidence: 'medium' }],
      measure_candidates: [
        { name: 'profit', score: 0.95, confidence: 'high' },
        { name: 'revenue', score: 0.9, confidence: 'high' },
      ],
      column_profiles: [
        mkColumn({ name: 'revenue', semantic_type: 'numeric' }),
        mkColumn({
          name: 'profit',
          semantic_type: 'numeric',
          histogram: [{ lower_bound: 0, upper_bound: 10, left_closed: false, right_closed: true, count: 1, pct_non_null: 100 }],
        }),
        mkColumn({ name: 'status', semantic_type: 'categorical' }),
      ],
    })

    expect(getTemporalColumnNames(profile)).toEqual(['order_date', 'created_at'])
    expect(getNumericColumnNames(profile)).toEqual(['profit', 'revenue'])

    const spec = createDefaultChartSpec('ds_001', profile)
    expect(spec.chartType).toBe('histogram')
    expect(spec.valueColumn).toBe('profit')
    expect(spec.valueColumnInteger).toBe(true)
    expect(spec.binCount).toBe(12)
    expect(spec.xColumn).toBe('order_date')
    expect(spec.xColumnBucketable).toBe(true)
    expect(spec.yColumns).toEqual(['profit', 'revenue'])
    expect(spec.aggregation).toBe('avg')
    expect(spec.bucket).toBe('month')
    expect(spec.title).toBe('profit distribution')
  })

  it('normalizes legacy line specs and preserves discrete temporal bucket behavior', () => {
    const profile = mkProfile({
      primary_temporal_column: { name: 'year', kind: 'discrete_period', confidence: 'high' },
      temporal_columns: [{ name: 'year', kind: 'discrete_period', confidence: 'high' }],
      measure_candidates: [{ name: 'rating', score: 0.9, confidence: 'high' }],
      column_profiles: [
        mkColumn({ name: 'year', semantic_type: 'numeric' }),
        mkColumn({ name: 'rating', semantic_type: 'numeric' }),
      ],
    })

    const spec = normalizeChartSpec({ version: 2, xColumn: 'year', yColumns: ['rating'] }, 'ds_001', profile)
    expect(spec.chartType).toBe('line')
    expect(spec.xColumn).toBe('year')
    expect(spec.xColumnBucketable).toBe(false)
    expect(spec.bucket).toBe('none')
    expect(buildLineChartSql(spec, 'player_ratings')).not.toContain('date_trunc')
    expect(buildLineChartSql(spec, 'player_ratings')).toContain('group by 1')
  })

  it('validates missing dataset, x axis, and y variables', () => {
    expect(validateChartSpec(baseSpec({ datasetId: '' }), 'orders').reason).toMatch(/Select a dataset/i)
    expect(validateChartSpec(baseSpec({ xColumn: '' }), 'orders').reason).toMatch(/temporal column/i)
    expect(validateChartSpec(baseSpec({ yColumns: [] }), 'orders').reason).toMatch(/numeric variable/i)
    expect(validateChartSpec(baseSpec(), 'orders')).toEqual({ valid: true, reason: null })
  })

  it('validates histogram value column and bins', () => {
    expect(validateChartSpec(baseSpec({ chartType: 'histogram', valueColumn: '' }), 'orders').reason).toMatch(/numeric variable/i)
    expect(validateChartSpec(baseSpec({ chartType: 'histogram', binCount: 0 }), 'orders').reason).toMatch(/bins/i)
    expect(validateChartSpec(baseSpec({ chartType: 'histogram' }), 'orders')).toEqual({ valid: true, reason: null })
  })

  it('builds quoted aggregate SQL with bucketing', () => {
    const sql = buildLineChartSql(baseSpec(), 'sales orders')

    expect(sql).toContain("date_trunc('month', \"order date\") as x")
    expect(sql).toContain('avg("gross revenue") as "gross revenue"')
    expect(sql).toContain('from "sales orders"')
    expect(sql).toContain('group by 1')
    expect(sql).toContain('limit 5000')
  })

  it('builds unaggregated SQL without grouping or bucket expression', () => {
    const sql = buildLineChartSql(baseSpec({ aggregation: 'none', bucket: 'none' }), 'orders')

    expect(sql).toContain('"order date" as x')
    expect(sql).toContain('"gross revenue"')
    expect(sql).toContain('profit')
    expect(sql).not.toContain('group by')
    expect(sql).not.toContain('date_trunc')
  })

  it('uses a time axis for raw continuous datetime charts', () => {
    const option = buildLineChartOption(
      baseSpec({ aggregation: 'none', bucket: 'none' }),
      [{ x: '2026-01-01T00:00:00Z', values: { 'gross revenue': 10, profit: 4 } }],
    )

    expect(option.xAxis).toEqual(expect.objectContaining({ type: 'time', data: undefined }))
    expect(option.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data: [['2026-01-01T00:00:00Z', 10]] }),
      ]),
    )
  })

  it('maps y-axis scale modes to explicit ECharts axis options', () => {
    const data = [{ x: '2026-01-01T00:00:00Z', values: { 'gross revenue': 48, profit: 46 } }]

    expect(buildLineChartOption(baseSpec({ yAxisScale: 'auto' }), data).yAxis).toEqual(
      expect.objectContaining({ scale: true }),
    )
    expect(buildLineChartOption(baseSpec({ yAxisScale: 'auto' }), data).yAxis).not.toEqual(
      expect.objectContaining({ min: 0 }),
    )
    expect(buildLineChartOption(baseSpec({ yAxisScale: 'zero' }), data).yAxis).toEqual(
      expect.objectContaining({ min: 0, scale: false }),
    )
    expect(
      buildLineChartOption(baseSpec({ yAxisScale: 'manual', yAxisMin: '40', yAxisMax: '50' }), data).yAxis,
    ).toEqual(expect.objectContaining({ min: 40, max: 50, scale: true }))
  })

  it('builds filtered SQL with escaped literals and richer aggregations', () => {
    const sql = buildLineChartSql(
      baseSpec({
        aggregation: 'median',
        filters: [
          { id: 'f1', column: 'region', operator: 'eq', value: "Bob's" },
          { id: 'f2', column: 'team', operator: 'in', value: 'A, B' },
        ],
      }),
      'orders',
    )

    expect(sql).toContain('median("gross revenue") as "gross revenue"')
    expect(sql).toContain("region = 'Bob''s'")
    expect(sql).toContain("team in ('A', 'B')")
  })

  it('builds split-by SQL and maps split rows into series values', () => {
    const spec = baseSpec({ yColumns: ['rating'], splitBy: 'team', aggregation: 'avg' })
    const sql = buildLineChartSql(spec, 'ratings')
    expect(sql).toContain('team as split')
    expect(sql).toContain('avg(rating) as value')
    expect(sql).toContain('group by')
    expect(sql).toContain('1,\n    2')

    const result: QueryResult = {
      columns: [{ name: 'x', type: null }, { name: 'split', type: null }, { name: 'value', type: null }],
      rows: [
        { x: 2025, split: 'A', value: 10 },
        { x: 2025, split: 'B', value: '12' },
      ],
      row_count: 2,
      truncated: false,
      error: null,
    }
    expect(queryResultToChartData(result, spec)).toEqual([{ x: 2025, values: { A: 10, B: 12 } }])
  })

  it('builds histogram SQL with bins, filters, split groups, and zero-count joins', () => {
    const sql = buildHistogramChartSql(
      baseSpec({
        chartType: 'histogram',
        valueColumn: 'gross revenue',
        binCount: 8,
        splitBy: 'region',
        filters: [{ id: 'f1', column: 'team', operator: 'eq', value: 'East' }],
      }),
      'sales orders',
    )

    expect(sql).toContain('with')
    expect(sql).toContain('range(8)')
    expect(sql).toContain('min("gross revenue") as min_v')
    expect(sql).toContain('greatest')
    expect(sql).toContain('least')
    expect(sql).toContain('select distinct')
    expect(sql.toLowerCase()).toContain('cast(region as varchar) as split')
    expect(sql).toContain('left join _dcc_counts')
    expect(sql).toContain("team = 'East'")
    expect(sql).toContain('or _dcc_bins.bin_index = 0')
    expect(buildChartSql(baseSpec({ chartType: 'histogram' }), 'orders')).toContain('range(12)')
  })

  it('builds integer histogram SQL with whole-number inclusive bins', () => {
    const spec = baseSpec({
      chartType: 'histogram',
      valueColumn: 'standing_tackle',
      valueColumnInteger: true,
      binCount: 12,
    })
    const sql = buildHistogramChartSql(spec, 'player_ratings')

    expect(sql.toLowerCase()).toContain('cast(min(standing_tackle) as bigint) as min_v')
    expect(sql).toContain('least(12, max_v - min_v + 1) as bucket_count')
    expect(sql).toContain('base_width')
    expect(sql).toContain('extra_bins')
    expect(sql).toContain('between _dcc_ranges.lower_bound and _dcc_ranges.upper_bound')
    expect(sql).not.toContain('nullif(_dcc_stats.max_v - _dcc_stats.min_v')
  })

  it('maps histogram rows into grouped chart data and renders bar options', () => {
    const spec = baseSpec({ chartType: 'histogram', splitBy: 'region', xAxisLabel: 'revenue', yAxisLabel: 'Count' })
    const result: QueryResult = {
      columns: [
        { name: 'bin_index', type: null },
        { name: 'lower_bound', type: null },
        { name: 'upper_bound', type: null },
        { name: 'split', type: null },
        { name: 'count', type: null },
      ],
      rows: [
        { bin_index: 0, lower_bound: 0, upper_bound: 10, split: 'East', count: 4 },
        { bin_index: 0, lower_bound: 0, upper_bound: 10, split: 'West', count: '2' },
        { bin_index: 1, lower_bound: 10, upper_bound: 20, split: 'East', count: 0 },
      ],
      row_count: 3,
      truncated: false,
      error: null,
    }

    const data = queryResultToChartData(result, spec)
    expect(data).toEqual([
      { x: '0 - 10', lowerBound: 0, upperBound: 10, values: { East: 4, West: 2 } },
      { x: '10 - 20', lowerBound: 10, upperBound: 20, values: { East: 0 } },
    ])

    const option = buildHistogramChartOption(spec, data)
    expect(option.xAxis).toEqual(expect.objectContaining({ type: 'category', data: ['0 - 10', '10 - 20'] }))
    expect(option.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'East', type: 'bar', data: [4, 0] }),
        expect.objectContaining({ name: 'West', type: 'bar', data: [2, 0] }),
      ]),
    )
    expect((option.tooltip as { formatter: (params: unknown) => string }).formatter([
      { axisValueLabel: '0 - 10', seriesName: 'East', value: 4 },
      { axisValueLabel: '0 - 10', seriesName: 'West', value: 2 },
    ])).toContain('0 - 10')
  })

  it('maps query rows into chart data and coerces numeric strings', () => {
    const result: QueryResult = {
      columns: [{ name: 'x', type: null }, { name: 'revenue', type: null }],
      rows: [
        { x: '2026-01-01', revenue: '12.5', profit: null },
        { x: '2026-02-01', revenue: 'bad', profit: 4 },
      ],
      row_count: 2,
      truncated: false,
      error: null,
    }

    expect(queryResultToChartData(result, ['revenue', 'profit'])).toEqual([
      { x: '2026-01-01', values: { revenue: 12.5, profit: null } },
      { x: '2026-02-01', values: { revenue: null, profit: 4 } },
    ])
  })
})

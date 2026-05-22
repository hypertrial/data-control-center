import { describe, expect, it } from 'vitest'
import type { QueryResult } from '@/api/types'
import { mkColumn, mkProfile } from '@/test/profileFixtures'
import {
  buildLineChartOption,
  buildLineChartSql,
  createDefaultChartSpec,
  getNumericColumnNames,
  getTemporalColumnNames,
  queryResultToChartData,
  validateChartSpec,
  type ChartSpec,
} from '@/features/charts/chartUtils'

function baseSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    version: 2,
    datasetId: 'ds_001',
    chartType: 'line',
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
  it('selects temporal and numeric defaults from profile metadata', () => {
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
        mkColumn({ name: 'profit', semantic_type: 'numeric' }),
        mkColumn({ name: 'status', semantic_type: 'categorical' }),
      ],
    })

    expect(getTemporalColumnNames(profile)).toEqual(['order_date', 'created_at'])
    expect(getNumericColumnNames(profile)).toEqual(['profit', 'revenue'])

    const spec = createDefaultChartSpec('ds_001', profile)
    expect(spec.xColumn).toBe('order_date')
    expect(spec.xColumnBucketable).toBe(true)
    expect(spec.yColumns).toEqual(['profit', 'revenue'])
    expect(spec.aggregation).toBe('avg')
    expect(spec.bucket).toBe('month')
  })

  it('defaults discrete temporal axes to direct grouping without date buckets', () => {
    const profile = mkProfile({
      primary_temporal_column: { name: 'year', kind: 'discrete_period', confidence: 'high' },
      temporal_columns: [{ name: 'year', kind: 'discrete_period', confidence: 'high' }],
      measure_candidates: [{ name: 'rating', score: 0.9, confidence: 'high' }],
      column_profiles: [
        mkColumn({ name: 'year', semantic_type: 'numeric' }),
        mkColumn({ name: 'rating', semantic_type: 'numeric' }),
      ],
    })

    const spec = createDefaultChartSpec('ds_001', profile)
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

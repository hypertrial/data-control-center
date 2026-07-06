import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildBarChartSql,
  buildChartSql,
  buildHistogramChartSql,
  buildLineChartSql,
  buildScatterChartSql,
} from '@/features/charts/chartSql'
import type { ChartSpec } from '@/features/charts/chartSpec'

type ChartSqlFixtureCase = {
  case_id: string
  view_name: string
  spec: ChartSpec
  sql: string
  min_rows: number
}

const fixtureCases = JSON.parse(
  readFileSync(resolve(process.cwd(), '../backend/tests/fixtures/chart_sql_cases.json'), 'utf8'),
) as ChartSqlFixtureCase[]

function baseSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    version: 4,
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
    topN: 25,
    ...overrides,
  }
}

describe('chartSql', () => {
  for (const fixtureCase of fixtureCases) {
    it(`matches shared SQL fixture ${fixtureCase.case_id}`, () => {
      expect(buildChartSql(fixtureCase.spec, fixtureCase.view_name)).toBe(fixtureCase.sql)
    })
  }

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
    expect(sql).not.toContain('group by')
    expect(sql).not.toContain('date_trunc')
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

  it('builds split-by SQL', () => {
    const sql = buildLineChartSql(baseSpec({ yColumns: ['rating'], splitBy: 'team', aggregation: 'avg' }), 'ratings')
    expect(sql).toContain('team as split')
    expect(sql).toContain('avg(rating) as value')
    expect(sql).toContain('group by')
  })

  it('builds histogram SQL with bins, filters, and split groups', () => {
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
    expect(sql.toLowerCase()).toContain('with')
    expect(sql).toContain('range(8)')
    expect(buildChartSql(baseSpec({ chartType: 'histogram' }), 'orders')).toContain('range(12)')
  })

  it('builds integer histogram SQL with whole-number inclusive bins', () => {
    const sql = buildHistogramChartSql(
      baseSpec({
        chartType: 'histogram',
        valueColumn: 'standing_tackle',
        valueColumnInteger: true,
        binCount: 12,
      }),
      'player_ratings',
    )
    expect(sql.toLowerCase()).toContain('cast(min(standing_tackle) as bigint) as min_v')
    expect(sql).toContain('least(12, max_v - min_v + 1) as bucket_count')
  })

  it('builds bar SQL for count-only and aggregated measures with top N', () => {
    const countSql = buildBarChartSql(
      baseSpec({ chartType: 'bar', xColumn: 'region', yColumns: [], aggregation: 'count', topN: 10 }),
      'orders',
    )
    expect(countSql.toLowerCase()).toContain('_dcc_bar_ranked')
    expect(countSql.toLowerCase()).toContain('max(_dcc_bar_ranked.sort_value)')

    const sumSql = buildBarChartSql(
      baseSpec({ chartType: 'bar', xColumn: 'region', yColumns: ['gross revenue'], aggregation: 'sum', topN: 15 }),
      'orders',
    )
    expect(sumSql).toContain('sum("gross revenue")')
    expect(sumSql.toLowerCase()).toContain('max(_dcc_bar_ranked.sort_value)')
  })

  it('builds bar split SQL', () => {
    const sql = buildBarChartSql(
      baseSpec({
        chartType: 'bar',
        xColumn: 'region',
        yColumns: ['gross revenue'],
        aggregation: 'avg',
        splitBy: 'team',
        topN: 5,
      }),
      'orders',
    )
    expect(sql.toLowerCase()).toContain('cast(team as varchar) as split')
    expect(sql.toLowerCase()).toContain('max(_dcc_bar_ranked.sort_value)')
  })

  it('builds scatter SQL without grouping', () => {
    const sql = buildScatterChartSql(
      baseSpec({ chartType: 'scatter', xColumn: 'gross revenue', yColumns: ['profit'], aggregation: 'none' }),
      'orders',
    )
    expect(sql).toContain('"gross revenue" as x')
    expect(sql).not.toContain('group by')
    expect(sql).toContain('limit 5000')
  })
})

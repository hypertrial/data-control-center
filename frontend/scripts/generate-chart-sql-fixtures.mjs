import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptDir, '..')
const repoRoot = resolve(frontendRoot, '..')
const outputPath = resolve(repoRoot, 'backend/tests/fixtures/chart_sql_cases.json')
const viewName = 'chart_orders'

function baseSpec(overrides = {}) {
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

const definitions = [
  {
    case_id: 'bar_count',
    spec: baseSpec({ chartType: 'bar', xColumn: 'region', yColumns: [], aggregation: 'count', topN: 10 }),
    min_rows: 1,
  },
  {
    case_id: 'bar_sum',
    spec: baseSpec({
      chartType: 'bar',
      xColumn: 'region',
      yColumns: ['gross revenue'],
      aggregation: 'sum',
      topN: 15,
    }),
    min_rows: 1,
  },
  {
    case_id: 'bar_split',
    spec: baseSpec({
      chartType: 'bar',
      xColumn: 'region',
      yColumns: ['gross revenue'],
      aggregation: 'avg',
      splitBy: 'team',
      topN: 5,
    }),
    min_rows: 1,
  },
  {
    case_id: 'line_aggregate',
    spec: baseSpec(),
    min_rows: 1,
  },
  {
    case_id: 'histogram_integer',
    spec: baseSpec({
      chartType: 'histogram',
      valueColumn: 'profit',
      valueColumnInteger: true,
      binCount: 12,
    }),
    min_rows: 1,
  },
  {
    case_id: 'scatter',
    spec: baseSpec({
      chartType: 'scatter',
      xColumn: 'gross revenue',
      yColumns: ['profit'],
      aggregation: 'none',
    }),
    min_rows: 1,
  },
]

const server = await createServer({
  configFile: resolve(frontendRoot, 'vite.config.ts'),
  root: frontendRoot,
  server: { hmr: false, middlewareMode: true, ws: false },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const { buildChartSql } = await server.ssrLoadModule('/src/features/charts/chartSql.ts')
  const cases = definitions.map((definition) => ({
    case_id: definition.case_id,
    view_name: viewName,
    spec: definition.spec,
    sql: buildChartSql(definition.spec, viewName),
    min_rows: definition.min_rows,
  }))
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(cases, null, 2)}\n`, 'utf8')
} finally {
  await server.close()
}

import { nativeSelectClassName } from '@/features/charts/chartControlOptions'
import { ControlGroup, Field } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import {
  DEFAULT_BAR_TOP_N,
  getDefaultCategoryColumn,
  getDefaultScatterColumns,
  type ChartType,
} from '@/features/charts/chartUtils'

type Props = Pick<
  ChartWorkspaceState,
  | 'profile'
  | 'spec'
  | 'patchSpec'
  | 'temporalColumns'
  | 'numericColumns'
  | 'categoryColumns'
  | 'isBucketableTemporalColumn'
  | 'getTemporalKind'
  | 'getColumnIsInteger'
>

export function ChartTypeControls({
  profile,
  spec,
  patchSpec,
  temporalColumns,
  numericColumns,
  categoryColumns,
  isBucketableTemporalColumn,
  getTemporalKind,
  getColumnIsInteger,
}: Props) {
  return (
    <ControlGroup title="Chart">
      <Field label="Chart type">
        <select
          className={nativeSelectClassName()}
          value={spec.chartType}
          onChange={(e) => {
            const chartType = e.target.value as ChartType
            if (chartType === 'histogram') {
              const valueColumn = spec.valueColumn || spec.yColumns[0] || numericColumns[0] || ''
              patchSpec({
                chartType,
                valueColumn,
                valueColumnInteger: getColumnIsInteger(profile, valueColumn),
                xAxisLabel: valueColumn,
                yAxisLabel: 'Count',
                yAxisScale: 'zero',
                title: valueColumn ? `${valueColumn} distribution` : 'Dataset distribution',
                referenceLines: [],
              })
              return
            }

            if (chartType === 'bar') {
              const xColumn = spec.xColumn && categoryColumns.includes(spec.xColumn)
                ? spec.xColumn
                : getDefaultCategoryColumn(profile)
              const measure = spec.yColumns[0] || numericColumns[0] || ''
              const countOnly = !measure
              patchSpec({
                chartType,
                xColumn,
                yColumns: countOnly ? [] : [measure],
                aggregation: countOnly ? 'count' : spec.aggregation === 'count' ? 'count' : 'sum',
                topN: spec.topN || DEFAULT_BAR_TOP_N,
                bucket: 'none',
                xColumnBucketable: false,
                xColumnTemporalKind: null,
                xAxisLabel: xColumn,
                yAxisLabel: countOnly ? 'Count' : measure,
                yAxisScale: 'zero',
                title: xColumn
                  ? countOnly
                    ? `${xColumn} by count`
                    : `${xColumn} by ${measure}`
                  : 'Category comparison',
                referenceLines: [],
              })
              return
            }

            if (chartType === 'scatter') {
              const defaults = getDefaultScatterColumns(profile)
              const xColumn = numericColumns.includes(spec.xColumn) ? spec.xColumn : defaults.x
              const yColumn =
                numericColumns.includes(spec.yColumns[0] ?? '') && spec.yColumns[0] !== xColumn
                  ? spec.yColumns[0]!
                  : defaults.y !== xColumn
                    ? defaults.y
                    : numericColumns.find((name) => name !== xColumn) ?? ''
              patchSpec({
                chartType,
                xColumn,
                yColumns: yColumn ? [yColumn] : [],
                aggregation: 'none',
                bucket: 'none',
                xColumnBucketable: false,
                xColumnTemporalKind: null,
                xAxisLabel: xColumn,
                yAxisLabel: yColumn,
                yAxisScale: 'auto',
                title: xColumn && yColumn ? `${yColumn} vs ${xColumn}` : 'Scatter plot',
                referenceLines: [],
                smooth: false,
                showPoints: false,
                connectNulls: false,
              })
              return
            }

            const xColumn = spec.xColumn || temporalColumns[0] || ''
            const xColumnBucketable = isBucketableTemporalColumn(profile, xColumn)
            const nextYColumns = spec.yColumns.length
              ? spec.yColumns
              : spec.valueColumn
                ? [spec.valueColumn]
                : numericColumns.filter((name) => name !== xColumn).slice(0, 3)
            const yColumns = spec.splitBy ? nextYColumns.slice(0, 1) : nextYColumns
            patchSpec({
              chartType,
              xColumn,
              xColumnBucketable,
              xColumnTemporalKind: getTemporalKind(profile, xColumn),
              yColumns,
              bucket: xColumnBucketable ? 'month' : 'none',
              xAxisLabel: xColumn,
              yAxisLabel: '',
              yAxisScale: 'auto',
              title: profile.name ? `${profile.name} trends` : 'Dataset trends',
            })
          }}
        >
          <option value="histogram">Histogram</option>
          <option value="bar">Bar</option>
          <option value="scatter">Scatter</option>
          <option value="line">Line</option>
        </select>
      </Field>
    </ControlGroup>
  )
}

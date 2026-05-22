import { nativeSelectClassName } from '@/features/charts/chartControlOptions'
import { ControlGroup, Field } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import type { ChartType } from '@/features/charts/chartUtils'

type Props = Pick<
  ChartWorkspaceState,
  | 'profile'
  | 'spec'
  | 'patchSpec'
  | 'temporalColumns'
  | 'numericColumns'
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
          <option value="line">Line</option>
        </select>
      </Field>
    </ControlGroup>
  )
}

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { AGGREGATIONS, BAR_AGGREGATIONS, BUCKETS, nativeSelectClassName } from '@/features/charts/chartControlOptions'
import { ControlGroup, Field } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import type { ChartAggregation, ChartBucket } from '@/features/charts/chartUtils'

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

export function ChartDataControls({
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
  const barCountOnly = spec.chartType === 'bar' && spec.aggregation === 'count' && !spec.yColumns[0]

  if (spec.chartType === 'histogram') {
    return (
      <ControlGroup title="Data">
        <Field label="Value column">
          <select
            className={nativeSelectClassName()}
            value={spec.valueColumn}
            onChange={(e) => {
              const valueColumn = e.target.value
              patchSpec({
                valueColumn,
                valueColumnInteger: getColumnIsInteger(profile, valueColumn),
                xAxisLabel: valueColumn,
                title: valueColumn ? `${valueColumn} distribution` : spec.title,
              })
            }}
          >
            {numericColumns.length === 0 ? <option value="">No numeric variables</option> : null}
            {numericColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bins">
          <Input
            className="h-8"
            type="number"
            min={1}
            max={100}
            value={spec.binCount}
            onChange={(e) => patchSpec({ binCount: Number(e.target.value) })}
          />
        </Field>
      </ControlGroup>
    )
  }

  if (spec.chartType === 'bar') {
    return (
      <ControlGroup title="Data">
        <Field label="Category">
          <select
            className={nativeSelectClassName()}
            value={spec.xColumn}
            onChange={(e) => {
              const xColumn = e.target.value
              patchSpec({
                xColumn,
                xAxisLabel: xColumn,
                title: barCountOnly
                  ? xColumn
                    ? `${xColumn} by count`
                    : spec.title
                  : xColumn && spec.yColumns[0]
                    ? `${xColumn} by ${spec.yColumns[0]}`
                    : spec.title,
              })
            }}
          >
            {categoryColumns.length === 0 ? <option value="">No category columns</option> : null}
            {categoryColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Measure">
          <select
            className={nativeSelectClassName(barCountOnly)}
            value={spec.yColumns[0] ?? ''}
            disabled={barCountOnly}
            onChange={(e) => {
              const measure = e.target.value
              patchSpec({
                yColumns: measure ? [measure] : [],
                yAxisLabel: measure || 'Count',
                title: spec.xColumn && measure ? `${spec.xColumn} by ${measure}` : spec.title,
              })
            }}
          >
            {barCountOnly ? <option value="">Count rows (no measure)</option> : null}
            {numericColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Aggregation">
            <select
              className={nativeSelectClassName()}
              value={spec.aggregation}
              onChange={(e) => {
                const aggregation = e.target.value as ChartAggregation
                if (aggregation === 'count') {
                  patchSpec({
                    aggregation,
                    yColumns: [],
                    yAxisLabel: 'Count',
                    title: spec.xColumn ? `${spec.xColumn} by count` : spec.title,
                  })
                  return
                }
                const measure = spec.yColumns[0] || numericColumns[0] || ''
                patchSpec({
                  aggregation,
                  yColumns: measure ? [measure] : [],
                  yAxisLabel: measure,
                })
              }}
            >
              {BAR_AGGREGATIONS.map((aggregation) => (
                <option key={aggregation.value} value={aggregation.value}>
                  {aggregation.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Top N">
            <Input
              className="h-8"
              type="number"
              min={1}
              max={100}
              value={spec.topN}
              onChange={(e) => patchSpec({ topN: Number(e.target.value) })}
            />
          </Field>
        </div>
      </ControlGroup>
    )
  }

  if (spec.chartType === 'scatter') {
    return (
      <ControlGroup title="Data">
        <Field label="X variable">
          <select
            className={nativeSelectClassName()}
            value={spec.xColumn}
            onChange={(e) => {
              const xColumn = e.target.value
              patchSpec({
                xColumn,
                xAxisLabel: xColumn,
                title:
                  xColumn && spec.yColumns[0] ? `${spec.yColumns[0]} vs ${xColumn}` : spec.title,
              })
            }}
          >
            {numericColumns.length === 0 ? <option value="">No numeric variables</option> : null}
            {numericColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Y variable">
          <select
            className={nativeSelectClassName()}
            value={spec.yColumns[0] ?? ''}
            onChange={(e) => {
              const yColumn = e.target.value
              patchSpec({
                yColumns: yColumn ? [yColumn] : [],
                yAxisLabel: yColumn,
                title: spec.xColumn && yColumn ? `${yColumn} vs ${spec.xColumn}` : spec.title,
              })
            }}
          >
            {numericColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </Field>
      </ControlGroup>
    )
  }

  return (
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
  )
}

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCount } from '@/lib/format'
import { Y_SCALE_OPTIONS, nativeSelectClassName } from '@/features/charts/chartControlOptions'
import { ControlGroup, Field } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import type { ChartYAxisScale } from '@/features/charts/chartUtils'

type Props = Pick<
  ChartWorkspaceState,
  | 'profile'
  | 'spec'
  | 'patchSpec'
  | 'splitColumns'
  | 'splitWarning'
  | 'splitCardinality'
  | 'getColumnSemanticType'
>

export function ChartSplitControls({
  profile,
  spec,
  patchSpec,
  splitColumns,
  splitWarning,
  splitCardinality,
  getColumnSemanticType,
}: Props) {
  return (
    <ControlGroup title="Split">
      <Field label="Split by">
        <select
          className={nativeSelectClassName()}
          value={spec.splitBy}
          onChange={(e) => {
            const splitBy = e.target.value
            patchSpec({
              splitBy,
              yColumns: spec.chartType === 'line' && splitBy ? spec.yColumns.slice(0, 1) : spec.yColumns,
            })
          }}
        >
          <option value="">None</option>
          {splitColumns.map((column) => (
            <option key={column} value={column}>
              {column} · {getColumnSemanticType(profile, column)}
            </option>
          ))}
        </select>
      </Field>
      {splitWarning ? (
        <p className="text-xs text-[hsl(var(--severity-warning))]">
          {spec.splitBy} has about {formatCount(splitCardinality)} values; the legend may be dense.
        </p>
      ) : null}
    </ControlGroup>
  )
}

export function ChartScaleControls({ spec, patchSpec }: Pick<ChartWorkspaceState, 'spec' | 'patchSpec'>) {
  return (
    <ControlGroup title="Scale">
      <Field label="Y scale">
        <select
          className={nativeSelectClassName()}
          value={spec.yAxisScale}
          onChange={(e) => patchSpec({ yAxisScale: e.target.value as ChartYAxisScale })}
        >
          {Y_SCALE_OPTIONS.map((scale) => (
            <option key={scale.value} value={scale.value}>
              {scale.label}
            </option>
          ))}
        </select>
      </Field>
      {spec.yAxisScale === 'manual' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Y min">
            <Input className="h-8" value={spec.yAxisMin} onChange={(e) => patchSpec({ yAxisMin: e.target.value })} />
          </Field>
          <Field label="Y max">
            <Input className="h-8" value={spec.yAxisMax} onChange={(e) => patchSpec({ yAxisMax: e.target.value })} />
          </Field>
        </div>
      ) : null}
      {spec.chartType === 'line' ? (
        <div className="space-y-2">
          {spec.referenceLines.map((line) => (
            <div key={line.id} className="grid grid-cols-[1fr_5rem_auto] gap-1">
              <Input
                className="h-8"
                value={line.label}
                placeholder="Label"
                onChange={(e) =>
                  patchSpec({
                    referenceLines: spec.referenceLines.map((item) => (item.id === line.id ? { ...item, label: e.target.value } : item)),
                  })
                }
              />
              <Input
                className="h-8"
                value={line.value}
                placeholder="Value"
                onChange={(e) =>
                  patchSpec({
                    referenceLines: spec.referenceLines.map((item) => (item.id === line.id ? { ...item, value: e.target.value } : item)),
                  })
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Remove reference line"
                onClick={() => patchSpec({ referenceLines: spec.referenceLines.filter((item) => item.id !== line.id) })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1"
            onClick={() => patchSpec({ referenceLines: [...spec.referenceLines, { id: crypto.randomUUID(), label: 'Reference', value: '' }] })}
          >
            <Plus className="h-3.5 w-3.5" /> Add reference line
          </Button>
        </div>
      ) : null}
    </ControlGroup>
  )
}

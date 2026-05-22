import { Input } from '@/components/ui/input'
import { ControlGroup, Field, ToggleField } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'

type Props = Pick<ChartWorkspaceState, 'spec' | 'patchSpec'>

export function ChartDisplayControls({ spec, patchSpec }: Props) {
  return (
    <ControlGroup title="Display">
      <Field label="Title">
        <Input className="h-8" value={spec.title} onChange={(e) => patchSpec({ title: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X label">
          <Input className="h-8" value={spec.xAxisLabel} onChange={(e) => patchSpec({ xAxisLabel: e.target.value })} />
        </Field>
        <Field label="Y label">
          <Input className="h-8" value={spec.yAxisLabel} onChange={(e) => patchSpec({ yAxisLabel: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ToggleField label="Legend" checked={spec.showLegend} onChange={(showLegend) => patchSpec({ showLegend })} />
        <ToggleField label="Zoom slider" checked={spec.showDataZoom} onChange={(showDataZoom) => patchSpec({ showDataZoom })} />
        {spec.chartType === 'line' ? (
          <>
            <ToggleField label="Smooth" checked={spec.smooth} onChange={(smooth) => patchSpec({ smooth })} />
            <ToggleField label="Points" checked={spec.showPoints} onChange={(showPoints) => patchSpec({ showPoints })} />
            <ToggleField label="Connect nulls" checked={spec.connectNulls} onChange={(connectNulls) => patchSpec({ connectNulls })} />
          </>
        ) : null}
      </div>
    </ControlGroup>
  )
}

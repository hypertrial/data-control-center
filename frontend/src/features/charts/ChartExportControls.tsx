import { Download, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ControlGroup } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'

type Props = Pick<
  ChartWorkspaceState,
  'canRenderChart' | 'runChart' | 'downloadPng' | 'downloadCsv' | 'downloadSpec' | 'resetZoom'
>

export function ChartExportControls({ canRenderChart, runChart, downloadPng, downloadCsv, downloadSpec, resetZoom }: Props) {
  return (
    <ControlGroup title="Export">
      <div className="grid grid-cols-2 gap-1">
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!canRenderChart} onClick={downloadPng}>
          <Download className="h-3.5 w-3.5" /> PNG
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!runChart.data || !!runChart.data.error} onClick={downloadCsv}>
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={downloadSpec}>
          <Download className="h-3.5 w-3.5" /> Spec
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!canRenderChart} onClick={resetZoom}>
          <ZoomOut className="h-3.5 w-3.5" /> Zoom
        </Button>
      </div>
    </ControlGroup>
  )
}

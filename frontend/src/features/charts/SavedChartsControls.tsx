import { Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { nativeSelectClassName } from '@/features/charts/chartControlOptions'
import { ControlGroup } from '@/features/charts/chartPageUi'
import type { ChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'

type Props = Pick<
  ChartWorkspaceState,
  | 'savedChartsQ'
  | 'selectedSavedChartId'
  | 'loadSaved'
  | 'saveAsNew'
  | 'updateSaved'
  | 'duplicateSaved'
  | 'renameSaved'
  | 'removeSaved'
>

export function SavedChartsControls({
  savedChartsQ,
  selectedSavedChartId,
  loadSaved,
  saveAsNew,
  updateSaved,
  duplicateSaved,
  renameSaved,
  removeSaved,
}: Props) {
  return (
    <ControlGroup title="Saved Charts">
      <div className="grid gap-2">
        <select className={nativeSelectClassName()} value={selectedSavedChartId} onChange={(e) => loadSaved(e.target.value)}>
          <option value="">Unsaved chart</option>
          {(savedChartsQ.data ?? []).map((chart) => (
            <option key={chart.chart_id} value={chart.chart_id}>
              {chart.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-1">
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={saveAsNew}>
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!selectedSavedChartId} onClick={updateSaved}>
            Update
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!selectedSavedChartId} onClick={duplicateSaved}>
            Duplicate
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button type="button" variant="outline" size="sm" disabled={!selectedSavedChartId} onClick={renameSaved}>
            Rename
          </Button>
          <Button type="button" variant="outline" size="sm" className="gap-1" disabled={!selectedSavedChartId} onClick={removeSaved}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
    </ControlGroup>
  )
}

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DatasetSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { SchemaDatasetBlock } from '@/features/query/SchemaDatasetBlock'

export function QuerySchemaRail({
  activeSummary,
  datasets,
  collapsed,
  onCollapsedChange,
  onInsert,
}: {
  activeSummary: DatasetSummary | undefined
  datasets: DatasetSummary[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onInsert: (fragment: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [otherDatasetsOpen, setOtherDatasetsOpen] = useState(false)

  const activeId = activeSummary?.dataset_id ?? null
  const activeSchemaExpanded = activeId ? (expanded[activeId] ?? true) : false
  const otherDatasets = datasets.filter((d) => d.dataset_id !== activeId)
  const toggleDs = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  return (
    <div
      className={
        collapsed
          ? 'relative flex w-9 shrink-0 flex-col items-center border-l border-border-default bg-black/20 py-2'
          : 'relative flex w-[280px] shrink-0 flex-col border-l border-border-default bg-black/20 p-2'
      }
      data-testid="sql-schema-rail"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={collapsed ? 'Expand schema rail' : 'Collapse schema rail'}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>
      {collapsed ? (
        <span
          className="mt-4 select-none text-[10px] font-semibold uppercase tracking-widest text-fg-muted [writing-mode:vertical-rl]"
          aria-hidden
        >
          Schema
        </span>
      ) : (
        <>
          <div className="text-xs font-semibold text-fg-muted">Schema</div>
          <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto text-xs">
            {activeSummary ? (
              <SchemaDatasetBlock
                key={activeSummary.dataset_id}
                summary={activeSummary}
                expanded={activeSchemaExpanded}
                onToggle={() => toggleDs(activeSummary.dataset_id)}
                onInsert={onInsert}
              />
            ) : (
              <div className="text-fg-muted">Select a dataset to browse schema.</div>
            )}
            {otherDatasets.length > 0 ? (
              <div>
                <button
                  type="button"
                  className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted hover:text-fg"
                  onClick={() => setOtherDatasetsOpen((v) => !v)}
                >
                  {otherDatasetsOpen ? 'Hide other datasets' : 'Other datasets'}
                </button>
                {otherDatasetsOpen
                  ? otherDatasets.map((ds) => (
                      <SchemaDatasetBlock
                        key={ds.dataset_id}
                        summary={ds}
                        expanded={!!expanded[ds.dataset_id]}
                        onToggle={() => toggleDs(ds.dataset_id)}
                        onInsert={onInsert}
                      />
                    ))
                  : null}
              </div>
            ) : null}
            {datasets.length === 0 ? <div className="text-fg-muted">No datasets.</div> : null}
          </div>
        </>
      )}
    </div>
  )
}

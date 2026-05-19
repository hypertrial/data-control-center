import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ColumnProfile, DatasetSummary } from '@/api/types'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { quoteIdent } from '@/lib/sql'
import { cn } from '@/lib/utils'

export function SchemaDatasetBlock({
  summary,
  expanded,
  onToggle,
  onInsert,
}: {
  summary: DatasetSummary
  expanded: boolean
  onToggle: () => void
  onInsert: (s: string) => void
}) {
  const pq = useDatasetProfile(expanded ? summary.dataset_id : null)

  const cols: ColumnProfile[] = pq.data?.column_profiles ?? []
  const viewIdent = quoteIdent(summary.view_name)

  return (
    <div className="rounded-lg border border-border-default bg-white/[0.03]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-white/5"
      >
        <span className="truncate font-mono text-white/90">{summary.name}</span>
        <span className="shrink-0 text-fg-muted">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <ul className="max-h-48 overflow-auto border-t border-border-default px-2 py-1">
          {pq.isPendingProfile && <li className="py-1 text-[hsl(var(--muted))]">Profiling…</li>}
          {pq.isError && <li className="py-1 text-red-300">{(pq.error as Error).message}</li>}
          {cols.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left font-mono hover:bg-white/10',
                )}
                onClick={() => onInsert(`${viewIdent}.${quoteIdent(c.name)} `)}
                title="Insert at cursor"
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-[10px] text-[hsl(var(--muted))]">{c.physical_type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

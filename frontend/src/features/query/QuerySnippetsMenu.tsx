import { History, X } from 'lucide-react'
import type { SavedQuery } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type SqlTemplate = {
  label: string
  sql: string
}

export function QuerySnippetsMenu({
  templates,
  history,
  savedQueries,
  onSetSql,
  onRemoveHistory,
  onDeleteSaved,
}: {
  templates: SqlTemplate[]
  history: string[]
  savedQueries: SavedQuery[]
  onSetSql: (sql: string) => void
  onRemoveHistory: (sql: string) => void
  onDeleteSaved: (savedId: string) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="gap-1">
          <History className="h-3.5 w-3.5" />
          Snippets ▾
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-96 w-96 overflow-y-auto p-0" align="start">
        <div className="border-b border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
          Templates
        </div>
        <ul className="p-1">
          {templates.map((t) => (
            <li key={t.label}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                onClick={() => onSetSql(t.sql)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-b border-t border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
          Recent
        </div>
        <ul className="p-1">
          {history.length === 0 ? (
            <li className="px-2 py-2 text-xs text-fg-muted">No local history yet.</li>
          ) : (
            history.map((h, i) => (
              <li key={i} className="group flex items-start gap-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                  onClick={() => onSetSql(h)}
                >
                  {h.slice(0, 120)}
                  {h.length > 120 ? '…' : ''}
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-fg-muted opacity-0 hover:bg-white/10 hover:text-fg group-hover:opacity-100"
                  aria-label="Remove from recent"
                  onClick={() => onRemoveHistory(h)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-b border-t border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
          Saved
        </div>
        <ul className="p-1">
          {savedQueries.length === 0 ? (
            <li className="px-2 py-2 text-xs text-fg-muted">None yet — use Save.</li>
          ) : (
            savedQueries.map((q) => (
              <li key={q.saved_id} className="group flex items-start gap-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                  onClick={() => onSetSql(q.sql)}
                >
                  <span className="font-medium text-fg">{q.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-fg-muted">
                    {q.sql.slice(0, 96)}
                    {q.sql.length > 96 ? '…' : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-fg-muted opacity-0 hover:bg-white/10 hover:text-fg group-hover:opacity-100"
                  aria-label={`Delete saved query ${q.name}`}
                  onClick={() => onDeleteSaved(q.saved_id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

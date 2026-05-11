import { useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useUiStore } from '@/store/uiStore'

export function QueryPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const template = activeId ? `SELECT * FROM v_${activeId} LIMIT 50;` : 'SELECT 1;'

  const m = useMutation({
    mutationFn: api.runQuery,
  })

  const viewHint = activeId != null ? `v_${activeId}` : 'v_ds_001'

  return (
    <div className="space-y-4 p-6">
      <div className="text-xs text-[hsl(var(--muted))]">
        Active dataset: {activeId ?? 'none'}. Example view:{' '}
        <span className="font-mono text-white">{viewHint}</span>
      </div>
      <textarea
        ref={textareaRef}
        key={activeId ?? 'none'}
        defaultValue={template}
        className="min-h-[160px] w-full rounded-md border border-white/15 bg-black/30 p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]/40"
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[120px] flex-1">
          <div className="mb-1 text-xs text-[hsl(var(--muted))]">max_rows</div>
          <Input id="max-rows" type="number" defaultValue={1000} />
        </div>
        <Button
          onClick={() => {
            const el = document.getElementById('max-rows') as HTMLInputElement | null
            const max = el?.value ? Number(el.value) : undefined
            const sql = textareaRef.current?.value ?? ''
            m.mutate({ sql, max_rows: max })
          }}
        >
          Run query
        </Button>
      </div>
      {m.isPending && <div className="text-sm">Running…</div>}
      {m.isError && <div className="text-sm text-red-300">{(m.error as Error).message}</div>}
      {m.data?.error && <div className="text-sm text-red-300">{m.data.error}</div>}
      {m.data && !m.data.error && (
        <div className="space-y-2">
          <div className="text-xs text-[hsl(var(--muted))]">
            {m.data.row_count} rows {m.data.truncated && '(truncated)'}
          </div>
          <Table>
            <THead>
              <TR>
                {m.data.columns.map((c) => (
                  <TH key={c.name}>
                    {c.name}
                    <span className="ml-1 text-[10px] font-normal text-[hsl(var(--muted))]">
                      {c.type}
                    </span>
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {m.data.rows.map((row, i) => (
                <TR key={i}>
                  {m.data!.columns.map((c) => (
                    <TD key={c.name} className="max-w-[240px] truncate font-mono text-xs">
                      {formatCell(row[c.name])}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function formatCell(v: unknown) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

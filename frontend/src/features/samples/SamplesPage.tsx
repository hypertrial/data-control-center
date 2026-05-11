import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useUiStore } from '@/store/uiStore'

export function SamplesPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const [page, setPage] = useState(1)
  const pageSize = 100

  const q = useQuery({
    queryKey: ['sample', activeId, page, pageSize],
    queryFn: () => api.getSample(activeId!, page, pageSize),
    enabled: !!activeId,
  })

  if (!activeId)
    return <div className="p-6 text-[hsl(var(--muted))]">Select a dataset.</div>
  if (q.isLoading) return <div className="p-6">Loading sample…</div>
  if (q.isError) return <div className="p-6 text-red-300">{(q.error as Error).message}</div>

  const res = q.data!
  const cols = res.columns

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-[hsl(var(--muted))]">
          Page {res.page} · {res.row_count} rows (server-side)
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={res.row_count < pageSize}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Table>
        <THead>
          <TR>
            {cols.map((c) => (
              <TH key={c}>{c}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {res.rows.map((row, i) => (
            <TR key={i}>
              {cols.map((c) => (
                <TD key={c} className="max-w-[240px] truncate font-mono text-xs">
                  {formatCell(row[c])}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

function formatCell(v: unknown) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

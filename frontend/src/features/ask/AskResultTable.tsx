import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import type { QueryResult } from '@/api/types'
import { isNumericAskCell } from '@/features/ask/askTableUtils'
import { toast } from 'sonner'

function formatCell(v: unknown) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function toCsv(qr: QueryResult): string {
  const cols = qr.columns.map((c) => c.name)
  const esc = (v: unknown) => {
    const s = formatCell(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [cols.join(',')]
  for (const row of qr.rows) {
    lines.push(cols.map((c) => esc(row[c])).join(','))
  }
  return lines.join('\n')
}

export function AskResultTable({ queryResult }: { queryResult: QueryResult }) {
  const [cellDetail, setCellDetail] = useState<{ col: string; value: string } | null>(null)

  const typeByCol = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of queryResult.columns) m[c.name] = c.type ?? 'unknown'
    return m
  }, [queryResult.columns])

  if (queryResult.error || queryResult.columns.length === 0) return null

  const exportCsv = () => {
    const blob = toCsv(queryResult)
    void navigator.clipboard.writeText(blob)
    toast.success('CSV copied to clipboard')
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-fg-muted">
          <span className="tabular-nums">{queryResult.row_count}</span> rows
          {queryResult.truncated ? ' (truncated)' : ''}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <div className="max-h-[min(60vh,28rem)] max-w-full overflow-auto rounded-lg border border-border-default">
        <Table>
          <caption className="sr-only">Query result</caption>
          <THead className="sticky top-0 z-[1] bg-surface-1/95 shadow-sm backdrop-blur">
            <TR>
              {queryResult.columns.map((c) => (
                <TH key={c.name} scope="col" className="whitespace-nowrap text-xs">
                  {c.name}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {queryResult.rows.map((row, i) => (
              <TR key={i}>
                {queryResult.columns.map((c) => {
                  const v = formatCell(row[c.name])
                  return (
                    <TD
                      key={c.name}
                      className={
                        isNumericAskCell(typeByCol, c.name)
                          ? 'group relative max-w-[200px] cursor-pointer truncate font-mono text-xs hover:bg-white/5'
                          : 'group relative max-w-[200px] cursor-pointer truncate text-xs hover:bg-white/5'
                      }
                      title={v}
                      onClick={() => setCellDetail({ col: c.name, value: v })}
                    >
                      <span className="block truncate">{v}</span>
                      <button
                        type="button"
                        className="absolute right-0 top-0 rounded bg-surface-1/90 px-1 py-0.5 text-[10px] opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          void navigator.clipboard.writeText(v)
                          toast.success('Cell copied')
                        }}
                      >
                        Copy
                      </button>
                    </TD>
                  )
                })}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <Dialog open={!!cellDetail} onOpenChange={(o) => !o && setCellDetail(null)}>
        <DialogContent title={cellDetail?.col} className="max-h-[80vh] overflow-auto max-w-lg">
          <pre className="whitespace-pre-wrap break-all text-xs text-white/90">{cellDetail?.value}</pre>
        </DialogContent>
      </Dialog>
    </>
  )
}

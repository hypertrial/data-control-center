import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { QueryResult, QueryResultColumn } from '@/api/types'
import { Button } from '@/components/ui/button'
import { queryResultToCsv } from '@/features/query/queryGridUtils'

export type SqlResultsToolbarProps = {
  queryResult: QueryResult
  busy?: boolean
  tooLargeForQuickExport: boolean
  sortedDataForExport: Record<string, unknown>[]
  copySelectionTsv: () => void
}

export function SqlResultsToolbar({
  queryResult,
  busy,
  tooLargeForQuickExport,
  sortedDataForExport,
  copySelectionTsv,
}: SqlResultsToolbarProps) {
  const columns = queryResult.columns as QueryResultColumn[]

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-default pb-2">
      <div className="text-xs text-[hsl(var(--muted))]">
        {busy ? (
          <span>Running…</span>
        ) : (
          <>
            <span className="tabular-nums text-white/90">{queryResult.row_count}</span> rows
            {queryResult.truncated ? <span className="text-[hsl(var(--severity-warning))]"> (truncated)</span> : null}
            {tooLargeForQuickExport ? <span className="text-[hsl(var(--severity-warning))]"> - large export</span> : null}
          </>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={copySelectionTsv} disabled={busy}>
        <Copy className="h-3.5 w-3.5" /> Copy TSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1"
        onClick={() => {
          if (tooLargeForQuickExport && !window.confirm('Large result. Copying JSON may be slow. Continue?')) return
          void navigator.clipboard.writeText(JSON.stringify(sortedDataForExport, null, 2))
          toast.success('Result rows copied as JSON')
        }}
        disabled={busy}
      >
        <Copy className="h-3.5 w-3.5" /> Copy JSON
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1"
        onClick={() => {
          if (tooLargeForQuickExport && !window.confirm('Large result. CSV export may be slow. Continue?')) return
          void navigator.clipboard.writeText(queryResultToCsv(columns, sortedDataForExport))
          toast.success('CSV copied to clipboard')
        }}
        disabled={busy}
      >
        Export CSV
      </Button>
      <span className="text-[10px] text-[hsl(var(--muted))]">Click header to sort - Drag cells to select - Cmd/Ctrl+C copy TSV</span>
    </div>
  )
}

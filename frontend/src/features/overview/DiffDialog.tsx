import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'

type Props = {
  datasetId: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function ProfileDiffDialog({ datasetId, open, onOpenChange }: Props) {
  const q = useQuery({
    queryKey: ['profile-diff', datasetId],
    queryFn: () => api.getProfileDiff(datasetId!),
    enabled: open && !!datasetId,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="What changed" className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {!datasetId ? null : q.isLoading ? (
          <p className="text-sm text-fg-muted">Loading diff…</p>
        ) : q.isError ? (
          <QueryErrorBanner message={(q.error as Error).message} onRetry={() => void q.refetch()} />
        ) : q.data ? (
          <div className="space-y-4 text-sm">
            <p className="text-xs text-fg-muted">
              Comparing profile at <span className="font-mono">{q.data.created_at_b}</span> vs{' '}
              <span className="font-mono">{q.data.created_at_a}</span>.
            </p>
            {q.data.quality_score_delta != null ? (
              <div>
                <div className="text-[10px] font-medium uppercase text-fg-muted">Quality score Δ</div>
                <div className="tabular-nums text-lg font-semibold">
                  {q.data.quality_score_delta > 0 ? '+' : ''}
                  {q.data.quality_score_delta.toFixed(2)}
                </div>
              </div>
            ) : null}
            {q.data.new_columns.length ? (
              <div>
                <div className="text-[10px] font-medium uppercase text-fg-muted">New columns</div>
                <ul className="mt-1 list-inside list-disc font-mono text-xs">
                  {q.data.new_columns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {q.data.removed_columns.length ? (
              <div>
                <div className="text-[10px] font-medium uppercase text-fg-muted">Removed columns</div>
                <ul className="mt-1 list-inside list-disc font-mono text-xs">
                  {q.data.removed_columns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {q.data.null_pct_changes.length ? (
              <div>
                <div className="text-[10px] font-medium uppercase text-fg-muted">Null % shifts (largest deltas)</div>
                <div className="mt-2 max-h-48 overflow-auto rounded-md border border-border-default">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border-default bg-white/[0.03]">
                        <th className="p-2 text-left font-medium">Column</th>
                        <th className="p-2 text-right">Before</th>
                        <th className="p-2 text-right">After</th>
                        <th className="p-2 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.null_pct_changes.map((r) => (
                        <tr key={r.column} className="border-t border-border-default/80">
                          <td className="p-2 font-mono">{r.column}</td>
                          <td className="p-2 text-right tabular-nums">{r.before.toFixed(2)}</td>
                          <td className="p-2 text-right tabular-nums">{r.after.toFixed(2)}</td>
                          <td className="p-2 text-right tabular-nums">
                            {r.delta > 0 ? '+' : ''}
                            {r.delta.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-fg-muted">No column-level null percentage changes detected.</p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

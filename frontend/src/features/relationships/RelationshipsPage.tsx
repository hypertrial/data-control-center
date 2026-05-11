import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export function RelationshipsPage() {
  const q = useQuery({
    queryKey: ['relationships'],
    queryFn: api.relationships,
  })

  if (q.isLoading) return <div className="p-6">Loading relationships…</div>
  if (q.isError) return <div className="p-6 text-red-300">{(q.error as Error).message}</div>

  const rows = q.data ?? []

  return (
    <div className="space-y-4 p-6">
      <p className="text-sm text-[hsl(var(--muted))]">
        Heuristic join candidates from name similarity and sampled value overlap.
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Left</TH>
            <TH>Right</TH>
            <TH>Score</TH>
            <TH>Evidence</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r, i) => (
            <TR key={i}>
              <TD className="font-mono text-xs">
                {r.left_dataset_id}.{r.left_column}
              </TD>
              <TD className="font-mono text-xs">
                {r.right_dataset_id}.{r.right_column}
              </TD>
              <TD>{r.score}</TD>
              <TD className="text-xs text-[hsl(var(--muted))]">{r.evidence}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

import type { DatasetSummary, DuckDbRelationRef, DuckDbRelationSummary } from '@/api/types'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { formatCount } from '@/lib/format'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

const DUCKDB_IMPORT_POLL_MS = 1200
const DUCKDB_IMPORT_TIMEOUT_MS = 600_000

type DuckDbBusyState = 'import' | null

export type DuckDbImportSession = {
  uploadId: string
  filename: string
}

type Props = {
  session: DuckDbImportSession | null
  onClose: () => void
  onImported: (datasets: DatasetSummary[]) => void
}

function duckDbRelationKey(rel: Pick<DuckDbRelationSummary, 'schema' | 'name'>): string {
  return `${rel.schema}\u0000${rel.name}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function DuckDbImportDialog({ session, onClose, onImported }: Props) {
  const open = session !== null
  const uploadId = session?.uploadId ?? ''
  const filename = session?.filename ?? ''

  const inspectQ = useQuery({
    queryKey: ['duckdb-inspect', uploadId],
    queryFn: () => api.inspectDuckDb(uploadId),
    enabled: open && !!uploadId,
  })

  const [duckDbSelected, setDuckDbSelected] = useState<Set<string>>(new Set())
  const [duckDbAliases, setDuckDbAliases] = useState<Record<string, string>>({})
  const [duckDbBusy, setDuckDbBusy] = useState<DuckDbBusyState>(null)

  const duckDbRelations = useMemo(() => inspectQ.data ?? [], [inspectQ.data])
  const inspecting = inspectQ.isFetching
  const inspectError = inspectQ.isError ? (inspectQ.error as Error).message : null
  const busy = inspecting || !!duckDbBusy

  useEffect(() => {
    if (!inspectQ.isSuccess || !session) return
    toast.success(`Found ${inspectQ.data.length} importable relation(s) in ${session.filename}.`)
  }, [inspectQ.isSuccess, inspectQ.data, session])

  const waitForDuckDbImport = useCallback(async (jobId: string): Promise<DatasetSummary[]> => {
    const started = Date.now()
    for (;;) {
      if (Date.now() - started > DUCKDB_IMPORT_TIMEOUT_MS) {
        throw new Error('DuckDB import timed out.')
      }
      const job = await api.getJob(jobId)
      if (job.status === 'completed') {
        const datasets = job.result?.datasets
        return Array.isArray(datasets) ? (datasets as DatasetSummary[]) : []
      }
      if (job.status === 'failed' || job.status === 'canceled') {
        throw new Error(job.error_message || `DuckDB import ${job.status}.`)
      }
      await sleep(DUCKDB_IMPORT_POLL_MS)
    }
  }, [])

  const importDuckDb = useCallback(async () => {
    if (!uploadId) return
    const relations: DuckDbRelationRef[] = duckDbRelations
      .filter((rel) => duckDbSelected.has(duckDbRelationKey(rel)))
      .map((rel) => {
        const key = duckDbRelationKey(rel)
        const alias = (duckDbAliases[key] || '').trim()
        return { schema: rel.schema, name: rel.name, alias: alias || null }
      })
    if (!relations.length) {
      toast.error('Select at least one DuckDB table or view.')
      return
    }
    setDuckDbBusy('import')
    try {
      const job = await api.importDuckDbRelations(uploadId, relations)
      const imported = await waitForDuckDbImport(job.job_id)
      onImported(imported)
      onClose()
      toast.success(`Imported ${imported.length} DuckDB relation(s).`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDuckDbBusy(null)
    }
  }, [
    duckDbAliases,
    duckDbRelations,
    duckDbSelected,
    onClose,
    onImported,
    uploadId,
    waitForDuckDbImport,
  ])

  const selectedDuckDbCount = duckDbSelected.size

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        key={session?.uploadId ?? 'closed'}
        title="Import DuckDB"
        className="max-h-[85vh] max-w-3xl overflow-auto"
      >
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            <span className="font-medium text-fg">{filename}</span>
            {inspecting ? ' — loading tables and views…' : null}
          </p>

          {inspectError ? (
            <p className="text-sm text-[hsl(var(--status-error))]">{inspectError}</p>
          ) : null}

          {duckDbRelations.length ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDuckDbSelected((current) =>
                    current.size === duckDbRelations.length
                      ? new Set()
                      : new Set(duckDbRelations.map(duckDbRelationKey)),
                  )
                }}
              >
                {selectedDuckDbCount === duckDbRelations.length ? 'Clear selection' : 'Select all'}
              </Button>
            </div>
          ) : null}

          {duckDbRelations.length ? (
            <div className="overflow-hidden rounded-md border border-border-default">
              <div className="max-h-[42vh] overflow-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="sticky top-0 bg-surface-2 text-fg-muted">
                    <tr>
                      <th className="w-10 px-2 py-2"> </th>
                      <th className="px-2 py-2 font-medium">Relation</th>
                      <th className="px-2 py-2 font-medium">Type</th>
                      <th className="px-2 py-2 font-medium">Rows</th>
                      <th className="px-2 py-2 font-medium">Alias</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {duckDbRelations.map((rel) => {
                      const key = duckDbRelationKey(rel)
                      return (
                        <tr key={key} className="bg-surface-1/60">
                          <td className="px-2 py-2 align-middle">
                            <input
                              type="checkbox"
                              aria-label={`Select ${rel.schema}.${rel.name}`}
                              checked={duckDbSelected.has(key)}
                              disabled={busy}
                              onChange={(e) => {
                                setDuckDbSelected((current) => {
                                  const next = new Set(current)
                                  if (e.target.checked) next.add(key)
                                  else next.delete(key)
                                  return next
                                })
                              }}
                            />
                          </td>
                          <td className="px-2 py-2 align-middle">
                            <div className="font-medium text-fg">{rel.name}</div>
                            <div className="text-[10px] text-fg-muted">
                              {rel.schema} - {rel.column_count} column(s)
                            </div>
                          </td>
                          <td className="px-2 py-2 align-middle uppercase text-fg-muted">{rel.type}</td>
                          <td className="px-2 py-2 align-middle tabular-nums text-fg-muted">
                            {formatCount(rel.row_count)}
                          </td>
                          <td className="px-2 py-2 align-middle">
                            <Input
                              aria-label={`Alias for ${rel.schema}.${rel.name}`}
                              value={duckDbAliases[key] ?? ''}
                              placeholder={`${rel.schema}__${rel.name}`}
                              disabled={busy}
                              onChange={(e) =>
                                setDuckDbAliases((current) => ({ ...current, [key]: e.target.value }))
                              }
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={duckDbBusy === 'import'}
            disabled={inspecting || !!inspectError || !duckDbRelations.length}
            onClick={() => void importDuckDb()}
          >
            Import {selectedDuckDbCount || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

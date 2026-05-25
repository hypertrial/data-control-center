import type { DatasetSummary, DuckDbRelationRef, DuckDbRelationSummary } from '@/api/types'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { defaultDuckDbExportAlias } from '@/features/datasets/duckDbExportAlias'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

const DUCKDB_IMPORT_POLL_MS = 1200
const DUCKDB_IMPORT_TIMEOUT_MS = 600_000
const VIRTUALIZE_THRESHOLD = 100
const ROW_HEIGHT_PX = 52

type DuckDbBusyState = 'import' | null

export type DuckDbImportSession = {
  /** Empty while the upload request is in flight. */
  sourceId: string
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

type RowCountState = number | null | 'loading'

export function DuckDbImportDialog({ session, onClose, onImported }: Props) {
  const open = session !== null
  const sourceId = session?.sourceId ?? ''
  const filename = session?.filename ?? ''
  const staging = open && !sourceId

  const inspectQ = useQuery({
    queryKey: ['duckdb-inspect', sourceId],
    queryFn: () => api.inspectDuckDb(sourceId),
    enabled: open && !!sourceId,
  })

  const [search, setSearch] = useState('')
  const [activeSchemas, setActiveSchemas] = useState<Set<string>>(new Set())
  const [duckDbSelected, setDuckDbSelected] = useState<Set<string>>(new Set())
  const [duckDbAliases, setDuckDbAliases] = useState<Record<string, string>>({})
  const [rowCounts, setRowCounts] = useState<Record<string, RowCountState>>({})
  const [duckDbBusy, setDuckDbBusy] = useState<DuckDbBusyState>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const duckDbRelations = useMemo(() => inspectQ.data ?? [], [inspectQ.data])
  const inspecting = staging || inspectQ.isFetching
  const inspectError = inspectQ.isError ? (inspectQ.error as Error).message : null
  const busy = inspecting || !!duckDbBusy

  const sortedRelations = useMemo(() => {
    const copy = [...duckDbRelations]
    copy.sort((a, b) => {
      const schemaCmp = a.schema.localeCompare(b.schema)
      if (schemaCmp !== 0) return schemaCmp
      return a.name.localeCompare(b.name)
    })
    return copy
  }, [duckDbRelations])

  const availableSchemas = useMemo(() => {
    const counts = new Map<string, number>()
    for (const rel of duckDbRelations) {
      counts.set(rel.schema, (counts.get(rel.schema) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [duckDbRelations])

  const filteredRelations = useMemo(() => {
    let rows = sortedRelations
    if (activeSchemas.size > 0) {
      rows = rows.filter((rel) => activeSchemas.has(rel.schema))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((rel) => {
        const hay = `${rel.schema}.${rel.name} ${rel.type}`.toLowerCase()
        return hay.includes(q)
      })
    }
    return rows
  }, [activeSchemas, search, sortedRelations])

  const hasActiveFilters = activeSchemas.size > 0 || search.trim().length > 0

  const useVirtual = filteredRelations.length > VIRTUALIZE_THRESHOLD
  const virtualizer = useVirtualizer({
    count: useVirtual ? filteredRelations.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  })
  const virtualItems = useVirtual ? virtualizer.getVirtualItems() : []
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0
  const paddingBottom =
    useVirtual && virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
      : 0
  const visibleRelations = useVirtual
    ? virtualItems.map((vi) => filteredRelations[vi.index]!)
    : filteredRelations

  useEffect(() => {
    if (!open) {
      setSearch('')
      setActiveSchemas(new Set())
      setDuckDbSelected(new Set())
      setDuckDbAliases({})
      setRowCounts({})
    }
  }, [open, sourceId])

  useEffect(() => {
    if (!inspectQ.isSuccess || !session) return
    toast.success(`Found ${inspectQ.data.length} importable relation(s) in ${session.filename}.`)
  }, [inspectQ.isSuccess, inspectQ.data, session])

  useEffect(() => {
    if (!inspectQ.isSuccess || !filename) return
    setDuckDbAliases((current) => {
      const next = { ...current }
      for (const rel of inspectQ.data) {
        const key = duckDbRelationKey(rel)
        if (!(key in next)) {
          next[key] = defaultDuckDbExportAlias(filename, rel)
        }
      }
      return next
    })
  }, [inspectQ.isSuccess, inspectQ.data, filename])

  const loadRowCount = useCallback(
    async (rel: DuckDbRelationSummary) => {
      if (!sourceId) return
      const key = duckDbRelationKey(rel)
      setRowCounts((current) => ({ ...current, [key]: 'loading' }))
      try {
        const result = await api.duckDbRelationCount(sourceId, rel.schema, rel.name)
        setRowCounts((current) => ({ ...current, [key]: result.row_count }))
      } catch (e) {
        setRowCounts((current) => ({ ...current, [key]: null }))
        toast.error((e as Error).message)
      }
    },
    [sourceId],
  )

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
    if (!sourceId) return
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
      const job = await api.importDuckDbRelations(sourceId, relations)
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
    sourceId,
    waitForDuckDbImport,
  ])

  const selectedDuckDbCount = duckDbSelected.size

  const toggleRelationSelection = useCallback(
    (key: string) => {
      if (busy) return
      setDuckDbSelected((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [busy],
  )

  const renderRow = (rel: DuckDbRelationSummary) => {
    const key = duckDbRelationKey(rel)
    const selected = duckDbSelected.has(key)
    const countState = rowCounts[key] ?? rel.row_count
    const aliasValue = duckDbAliases[key] ?? defaultDuckDbExportAlias(filename, rel)
    return (
      <tr
        key={key}
        aria-selected={selected}
        tabIndex={busy ? -1 : 0}
        className={cn(
          'bg-surface-1/60 outline-none transition-colors',
          !busy && 'cursor-pointer hover:bg-surface-2/80',
          selected && 'bg-accent/10 hover:bg-accent/15',
        )}
        onClick={() => toggleRelationSelection(key)}
        onKeyDown={(e) => {
          if (busy || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          toggleRelationSelection(key)
        }}
      >
        <td className="w-10 px-2 py-2 align-middle">
          <input
            type="checkbox"
            aria-label={`Select ${rel.schema}.${rel.name}`}
            checked={selected}
            disabled={busy}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleRelationSelection(key)}
          />
        </td>
        <td className="max-w-0 overflow-hidden px-2 py-2 align-middle">
          <div className="truncate font-medium text-fg" title={rel.name}>
            {rel.name}
          </div>
          <div
            className="truncate text-[10px] text-fg-muted"
            title={`${rel.schema} · ${rel.column_count} column(s)`}
          >
            {rel.schema} · {rel.column_count} column(s)
          </div>
        </td>
        <td className="overflow-hidden whitespace-nowrap px-2 py-2 align-middle uppercase text-fg-muted">
          {rel.type}
        </td>
        <td className="overflow-hidden whitespace-nowrap px-2 py-2 align-middle tabular-nums text-fg-muted">
          {countState === 'loading' ? (
            <span className="text-[10px]">…</span>
          ) : countState != null ? (
            formatCount(countState)
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1 text-[10px]"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                void loadRowCount(rel)
              }}
            >
              Load
            </Button>
          )}
        </td>
        <td className="max-w-0 px-2 py-2 align-middle">
          <div className="overflow-x-auto rounded-md">
            <Input
              aria-label={`Alias for ${rel.schema}.${rel.name}`}
              value={aliasValue}
              title={aliasValue}
              disabled={busy}
              className="h-8 min-w-full w-max max-w-none font-mono text-[11px]"
              style={{ width: `${Math.max(28, aliasValue.length + 2)}ch` }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setDuckDbAliases((current) => ({ ...current, [key]: e.target.value }))}
            />
          </div>
        </td>
      </tr>
    )
  }

  const statusSuffix = staging
    ? ' — uploading…'
    : inspecting
      ? ' — loading catalog…'
      : ''

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        key={session?.sourceId ?? 'closed'}
        title="Import DuckDB"
        className="flex max-h-[min(90vh,900px)] w-[min(96vw,72rem)] max-w-6xl flex-col gap-3 overflow-hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="shrink-0 space-y-3">
            <p className="text-sm text-fg-muted">
              <span className="font-medium text-fg">{filename}</span>
              {statusSuffix}
            </p>

            {inspectError ? (
              <p className="text-sm text-[hsl(var(--status-error))]">{inspectError}</p>
            ) : null}

            {!staging && !inspecting && !inspectError && !duckDbRelations.length ? (
              <p className="text-sm text-fg-muted">No importable tables or views were found in this database.</p>
            ) : null}

            {duckDbRelations.length ? (
              <>
                {availableSchemas.length ? (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                      Schema
                    </span>
                    <div className="max-h-24 overflow-y-auto rounded-md border border-border-default/60 p-1.5">
                      <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={activeSchemas.size === 0 ? 'default' : 'outline'}
                      disabled={busy}
                      aria-label="Show all schemas"
                      aria-pressed={activeSchemas.size === 0}
                      onClick={() => setActiveSchemas(new Set())}
                    >
                      All ({duckDbRelations.length})
                    </Button>
                    {availableSchemas.map(([schema, count]) => {
                      const selected = activeSchemas.has(schema)
                      return (
                        <Button
                          key={schema}
                          type="button"
                          size="sm"
                          variant={selected ? 'default' : 'outline'}
                          disabled={busy}
                          aria-label={`Filter by schema ${schema}`}
                          aria-pressed={selected}
                          onClick={() => {
                            setActiveSchemas((current) => {
                              const next = new Set(current)
                              if (next.has(schema)) next.delete(schema)
                              else next.add(schema)
                              return next
                            })
                          }}
                        >
                          {schema} ({count})
                        </Button>
                      )
                    })}
                      </div>
                    </div>
                  </div>
                ) : null}
                <Input
                  aria-label="Search DuckDB tables and views"
                  placeholder="Search name or type…"
                  value={search}
                  disabled={busy}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || !filteredRelations.length}
                    onClick={() => {
                      setDuckDbSelected((current) =>
                        current.size === filteredRelations.length
                          ? new Set()
                          : new Set(filteredRelations.map(duckDbRelationKey)),
                      )
                    }}
                  >
                    {selectedDuckDbCount === filteredRelations.length && filteredRelations.length
                      ? 'Clear selection'
                      : 'Select all shown'}
                  </Button>
                  <span className="text-[10px] text-fg-muted">
                    {filteredRelations.length} of {duckDbRelations.length} relation(s)
                  </span>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {filteredRelations.length ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-default">
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[880px] table-fixed text-left text-xs">
                  <colgroup>
                    <col style={{ width: 40 }} />
                    <col style={{ width: '32%' }} />
                    <col style={{ width: 56 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: '44%' }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-surface-2 text-fg-muted">
                    <tr>
                      <th className="px-2 py-2"> </th>
                      <th className="max-w-0 px-2 py-2 font-medium">Relation</th>
                      <th className="px-2 py-2 font-medium">Type</th>
                      <th className="px-2 py-2 font-medium">Rows</th>
                      <th className="max-w-0 px-2 py-2 font-medium">Alias</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {useVirtual && paddingTop > 0 ? (
                      <tr aria-hidden>
                        <td colSpan={5} style={{ height: paddingTop, padding: 0, border: 0 }} />
                      </tr>
                    ) : null}
                    {visibleRelations.map((rel) => renderRow(rel))}
                    {useVirtual && paddingBottom > 0 ? (
                      <tr aria-hidden>
                        <td colSpan={5} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                </div>
              </div>
            ) : null}

            {duckDbRelations.length && !filteredRelations.length && hasActiveFilters ? (
              <p className="shrink-0 text-sm text-fg-muted">No relations match the current filters.</p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t border-border-default pt-3">
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

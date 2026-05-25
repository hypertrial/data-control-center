import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DatasetSummary, DuckDbRelationRef, DuckDbRelationSummary } from '@/api/types'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatasetDropzone } from '@/features/datasets/DatasetDropzone'
import { ACCEPT_ATTR, filterSupportedFiles } from '@/features/datasets/uploadFiles'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { Database, Loader2, PanelLeftClose, PanelLeft, Upload, X, FolderOpen, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { formatBytes, formatCount, formatDatasetFormat, stripFileExtension } from '@/lib/format'
import { qualityScoreSeverity } from '@/lib/tokens'

type SortMode = 'name' | 'rows' | 'quality'
type DuckDbBusyState = 'inspect' | 'import' | null

const DUCKDB_IMPORT_POLL_MS = 1200
const DUCKDB_IMPORT_TIMEOUT_MS = 600_000

function duckDbRelationKey(rel: Pick<DuckDbRelationSummary, 'schema' | 'name'>): string {
  return `${rel.schema}\u0000${rel.name}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function DatasetSidebar() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    activeDatasetId,
    setActiveDatasetId,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarMobileOpen,
    setSidebarMobileOpen,
  } = useUiStore()
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('name')
  const [dropHighlight, setDropHighlight] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [duckDbOpen, setDuckDbOpen] = useState(false)
  const [duckDbPath, setDuckDbPath] = useState('')
  const [duckDbRelations, setDuckDbRelations] = useState<DuckDbRelationSummary[]>([])
  const [duckDbSelected, setDuckDbSelected] = useState<Set<string>>(new Set())
  const [duckDbAliases, setDuckDbAliases] = useState<Record<string, string>>({})
  const [duckDbBusy, setDuckDbBusy] = useState<DuckDbBusyState>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const q = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const list = useMemo(() => q.data ?? [], [q.data])

  const sortedFiltered = useMemo(() => {
    let rows = list
    if (search.trim()) {
      const s = search.toLowerCase()
      rows = rows.filter((d) => d.name.toLowerCase().includes(s) || d.dataset_id.toLowerCase().includes(s))
    }
    const copy = [...rows]
    copy.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'rows') return (b.row_count ?? 0) - (a.row_count ?? 0)
      return (b.quality_score ?? -1) - (a.quality_score ?? -1)
    })
    return copy
  }, [list, search, sort])

  const uploadFiles = useCallback(
    async (picked: File[]) => {
      const files = filterSupportedFiles(picked)
      if (!files.length) {
        toast.error('No supported files (.csv, .tsv, .parquet, .json, .jsonl, .ndjson).')
        return
      }
      setBusy(true)
      try {
        const rows = await api.uploadDatasets(files)
        await qc.invalidateQueries({ queryKey: ['datasets'] })
        if (rows.length) {
          setActiveDatasetId(rows[rows.length - 1]!.dataset_id)
          toast.success(
            `Registered ${rows.length} file(s). Large files profile in the background; row counts and quality scores update when ready.`,
          )
        }
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [qc, setActiveDatasetId],
  )

  const inspectDuckDb = useCallback(async () => {
    const path = duckDbPath.trim()
    if (!path) {
      toast.error('Enter the path to a local .duckdb file.')
      return
    }
    setDuckDbBusy('inspect')
    try {
      const rows = await api.inspectDuckDb(path)
      setDuckDbRelations(rows)
      setDuckDbSelected(new Set())
      setDuckDbAliases({})
      toast.success(`Found ${rows.length} importable relation(s).`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDuckDbBusy(null)
    }
  }, [duckDbPath])

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
    const path = duckDbPath.trim()
    if (!path) {
      toast.error('Enter the path to a local .duckdb file.')
      return
    }
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
      const job = await api.importDuckDbRelations(path, relations)
      const imported = await waitForDuckDbImport(job.job_id)
      await qc.invalidateQueries({ queryKey: ['datasets'] })
      if (imported.length) {
        setActiveDatasetId(imported[imported.length - 1]!.dataset_id)
      }
      setDuckDbOpen(false)
      toast.success(`Imported ${imported.length} DuckDB relation(s).`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDuckDbBusy(null)
    }
  }, [
    duckDbAliases,
    duckDbPath,
    duckDbRelations,
    duckDbSelected,
    qc,
    setActiveDatasetId,
    waitForDuckDbImport,
  ])

  const removeDataset = useCallback(
    async (datasetId: string, name: string) => {
      try {
        await api.deleteDataset(datasetId)
        qc.setQueryData<DatasetSummary[]>(['datasets'], (old) => (old ?? []).filter((d) => d.dataset_id !== datasetId))
        qc.removeQueries({ queryKey: ['profile', datasetId] })
        qc.removeQueries({ queryKey: ['profile-history', datasetId] })
        qc.removeQueries({ queryKey: ['quality', datasetId] })
        qc.removeQueries({ queryKey: ['sample', datasetId] })
        qc.removeQueries({ queryKey: ['profile-diff', datasetId] })
        if (searchParams.get('ds') === datasetId) {
          const next = new URLSearchParams(searchParams)
          next.delete('ds')
          setSearchParams(next, { replace: true })
        }
        if (activeDatasetId === datasetId) setActiveDatasetId(null)
        await qc.invalidateQueries({ queryKey: ['datasets'] })
        toast.success(`Removed ${name}.`)
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setConfirmDelete(null)
      }
    },
    [activeDatasetId, qc, searchParams, setSearchParams, setActiveDatasetId],
  )

  const emptyWorkspace = !q.isLoading && list.length === 0
  const narrow = sidebarCollapsed
  const selectedDuckDbCount = duckDbSelected.size

  useEffect(() => {
    const onResize = () => {
      if (window.matchMedia('(min-width: 1024px)').matches) setSidebarMobileOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [setSidebarMobileOpen])

  return (
    <>
      {sidebarMobileOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarMobileOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-border-default bg-[hsl(var(--surface-1))] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0',
          narrow ? 'w-14' : 'w-72 max-w-[85vw]',
          sidebarMobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="border-b border-border-default px-2 py-2">
          <div className={cn('flex items-center gap-2 text-sm font-semibold', narrow && 'justify-center')}>
            {!narrow && <Database className="h-4 w-4 shrink-0" />}
            {!narrow && <span>Datasets</span>}
            {narrow && (
              <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)}>
                <PanelLeft className="h-4 w-4" />
              </Button>
            )}
            {!narrow && (
              <Button type="button" variant="ghost" size="icon" className="ml-auto hidden lg:inline-flex" aria-label="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}>
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" className="ml-auto lg:hidden" aria-label="Close" onClick={() => setSidebarMobileOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!narrow && emptyWorkspace ? (
            <div className="mt-3 space-y-3 rounded-lg border border-dashed border-border-default bg-white/[0.03] p-3 text-center text-xs leading-relaxed text-fg-muted">
              <Upload className="mx-auto h-6 w-6 text-fg-muted" aria-hidden />
              <p className="font-medium text-fg">No datasets in this workspace</p>
              <DatasetDropzone />
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setDuckDbOpen(true)}>
                <Database className="mr-2 h-3.5 w-3.5" />
                Import DuckDB
              </Button>
            </div>
          ) : null}

          {!narrow && !emptyWorkspace ? (
            <div
              className={cn('mt-3 space-y-2 rounded-lg border border-dashed border-border-default p-2 transition', dropHighlight && 'border-[hsl(var(--accent))] bg-white/[0.04]')}
              onDragEnter={(e) => {
                e.preventDefault()
                setDropHighlight(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDropHighlight(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHighlight(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDropHighlight(false)
                const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
                void uploadFiles(files)
              }}
            >
              <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" aria-label="Upload data files" onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : []
                e.target.value = ''
                void uploadFiles(files)
              }} />
              <input ref={folderInputRef} type="file" multiple className="sr-only" aria-label="Upload folder of data files" {...({ webkitdirectory: '' } as object)} onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : []
                e.target.value = ''
                void uploadFiles(files)
              }} />
              <Button type="button" variant="outline" size="sm" className="w-full" disabled={busy} aria-label="Upload files" onClick={() => fileInputRef.current?.click()}>
                {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                Upload
              </Button>
              <Button type="button" variant="outline" size="sm" className="w-full" disabled={busy} onClick={() => folderInputRef.current?.click()}>
                <FolderOpen className="mr-2 h-3.5 w-3.5" />
                Folder
              </Button>
              <Button type="button" variant="outline" size="sm" className="w-full" disabled={!!duckDbBusy} onClick={() => setDuckDbOpen(true)}>
                <Database className="mr-2 h-3.5 w-3.5" />
                Import DuckDB
              </Button>
            </div>
          ) : null}

          {narrow && !emptyWorkspace ? (
            <div className="mt-2 flex flex-col items-center gap-2">
              <Button type="button" variant="outline" size="icon" disabled={busy} aria-label="Upload files" onClick={() => fileInputRef.current?.click()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
              <Button type="button" variant="outline" size="icon" disabled={!!duckDbBusy} aria-label="Import DuckDB" onClick={() => setDuckDbOpen(true)}>
                <Database className="h-4 w-4" />
              </Button>
              <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" aria-label="Upload data files" onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : []
                e.target.value = ''
                void uploadFiles(files)
              }} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden p-2">
          {!narrow && list.length > 0 && (
            <div className="mb-2 flex shrink-0 flex-col gap-2">
              <Input id="dcc-sidebar-search" placeholder="Search datasets..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs" aria-label="Search datasets" />
              <label className="flex items-center gap-2 text-[10px] text-fg-muted">
                Sort
                <select className="h-7 flex-1 rounded-md border border-border-default bg-black/30 px-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                  <option value="name">Name</option>
                  <option value="rows">Rows</option>
                  <option value="quality">Quality</option>
                </select>
              </label>
              <div className="h-1 overflow-hidden rounded-full bg-white/10" title="Workspace quality mix">
                <div
                  className="h-full bg-[hsl(var(--severity-ok))]"
                  style={{
                    width: `${Math.min(100, (list.filter((d) => (d.quality_score ?? 0) >= 70).length / Math.max(1, list.length)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex-1 space-y-1 overflow-auto">
            {q.isLoading && <div className="text-sm text-fg-muted">Loading...</div>}
            {q.isError && <div className="text-sm text-red-300">{(q.error as Error).message}</div>}
            <ul className="space-y-1">
              {sortedFiltered.map((d) => {
                const active = activeDatasetId === d.dataset_id
                const sev = qualityScoreSeverity(d.quality_score ?? null)
                const dot = sev === 'critical' ? 'bg-[hsl(var(--severity-critical))]' : sev === 'warning' ? 'bg-[hsl(var(--severity-warning))]' : d.quality_score != null ? 'bg-[hsl(var(--severity-ok))]' : 'bg-white/20'
                return (
                  <li key={d.dataset_id} className="group relative">
                    <button
                      type="button"
                      title={`${d.dataset_id} - ${d.source_path}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        setActiveDatasetId(d.dataset_id)
                        setSidebarMobileOpen(false)
                      }}
                      className={cn(
                        'flex w-full flex-col rounded-md border border-transparent px-2 py-2 text-left text-sm transition',
                        active ? 'border-border-default bg-white/10 shadow-inner' : 'hover:bg-white/5',
                        active && 'border-l-2 border-l-[hsl(var(--accent))] pl-[6px]',
                        narrow && 'items-center px-1 py-2',
                        !narrow && 'pr-9',
                      )}
                    >
                      <div className={cn('flex items-center gap-2', narrow && 'justify-center')}>
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} title={d.quality_score != null ? `Quality ${d.quality_score}` : 'Not profiled'} />
                        {!narrow && (
                          <>
                            <span className="min-w-0 truncate font-medium">{stripFileExtension(d.name)}</span>
                            <span className="ml-auto shrink-0 rounded border border-border-default px-1 font-mono text-[10px] uppercase text-fg-muted">{formatDatasetFormat(d.format)}</span>
                          </>
                        )}
                      </div>
                      {!narrow && (
                        <div className="mt-0.5 pl-4 text-[10px] text-fg-muted">
                          <span className="tabular-nums">{formatCount(d.row_count)}</span> - <span className="tabular-nums">{formatBytes(d.file_size_bytes)}</span>
                          {d.quality_score != null ? <> - Q <span className="tabular-nums">{d.quality_score}</span></> : null}
                        </div>
                      )}
                    </button>
                    {!narrow && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7 text-fg-muted opacity-0 hover:text-[hsl(var(--status-error))] focus:opacity-100 group-hover:opacity-100"
                        aria-label={`Remove ${stripFileExtension(d.name)}`}
                        title="Remove dataset"
                        onClick={() => setConfirmDelete({ id: d.dataset_id, name: d.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </aside>

      <Dialog open={duckDbOpen} onOpenChange={(open) => !open && !duckDbBusy && setDuckDbOpen(false)}>
        <DialogContent title="Import DuckDB" className="max-h-[85vh] max-w-3xl overflow-auto">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-fg">
              DuckDB file path
              <Input
                className="mt-2"
                value={duckDbPath}
                placeholder="/absolute/path/source.duckdb"
                onChange={(e) => setDuckDbPath(e.target.value)}
                disabled={!!duckDbBusy}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" loading={duckDbBusy === 'inspect'} disabled={duckDbBusy === 'import'} onClick={() => void inspectDuckDb()}>
                Inspect
              </Button>
              {duckDbRelations.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!!duckDbBusy}
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
              ) : null}
            </div>

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
                                disabled={!!duckDbBusy}
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
                              <div className="text-[10px] text-fg-muted">{rel.schema} - {rel.column_count} column(s)</div>
                            </td>
                            <td className="px-2 py-2 align-middle uppercase text-fg-muted">{rel.type}</td>
                            <td className="px-2 py-2 align-middle tabular-nums text-fg-muted">{formatCount(rel.row_count)}</td>
                            <td className="px-2 py-2 align-middle">
                              <Input
                                aria-label={`Alias for ${rel.schema}.${rel.name}`}
                                value={duckDbAliases[key] ?? ''}
                                placeholder={`${rel.schema}__${rel.name}`}
                                disabled={!!duckDbBusy}
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
            <Button type="button" variant="ghost" disabled={!!duckDbBusy} onClick={() => setDuckDbOpen(false)}>Cancel</Button>
            <Button type="button" loading={duckDbBusy === 'import'} disabled={duckDbBusy === 'inspect'} onClick={() => void importDuckDb()}>
              Import {selectedDuckDbCount || ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent title="Remove dataset" className="max-w-md">
          <p className="text-sm text-fg-muted">Remove {confirmDelete?.name} from this workspace? Source files are not deleted.</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => confirmDelete && void removeDataset(confirmDelete.id, confirmDelete.name)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

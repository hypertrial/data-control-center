import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { Database, FolderOpen, Loader2, Upload } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { formatBytes, formatCount, formatDatasetFormat, stripFileExtension } from '@/lib/format'
import { qualityScoreSeverity } from '@/lib/tokens'

/** Mirrors backend `SUPPORTED_EXTENSIONS` for client-side filtering. */
const UPLOAD_EXT = new Set(['.csv', '.tsv', '.parquet', '.json', '.jsonl', '.ndjson'])

const ACCEPT_ATTR = '.csv,.tsv,.parquet,.json,.jsonl,.ndjson'

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function normalizeUploadFile(file: File): File {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  if (rel && rel.length > 0) {
    const safe = rel.replace(/[/\\]/g, '__')
    return new File([file], safe, { type: file.type, lastModified: file.lastModified })
  }
  return file
}

function filterSupportedFiles(files: File[]): File[] {
  return files.map(normalizeUploadFile).filter((f) => UPLOAD_EXT.has(extOf(f.name)))
}

type SortMode = 'name' | 'rows' | 'quality'

export function DatasetSidebar() {
  const qc = useQueryClient()
  const { activeDatasetId, setActiveDatasetId } = useUiStore()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dropzoneExpanded, setDropzoneExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('name')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const q = useQuery({
    queryKey: ['datasets'],
    queryFn: api.listDatasets,
  })

  const list = useMemo(() => q.data ?? [], [q.data])
  const many = list.length > 5

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
        setErr('No supported files (.csv, .tsv, .parquet, .json, .jsonl, .ndjson).')
        return
      }
      setBusy(true)
      setErr(null)
      try {
        const rows = await api.uploadDatasets(files)
        await qc.invalidateQueries({ queryKey: ['datasets'] })
        if (rows.length) setActiveDatasetId(rows[rows.length - 1]!.dataset_id)
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [qc, setActiveDatasetId],
  )

  const emptyWorkspace = !q.isLoading && list.length === 0

  return (
    <aside className="flex h-full w-72 flex-col border-r border-white/10 bg-[hsl(var(--card))]">
      <div className="border-b border-white/10 px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Database className="h-4 w-4" />
          Datasets
        </div>

        {emptyWorkspace ? (
          <div className="mt-4 space-y-3 rounded-lg border border-dashed border-white/20 bg-white/[0.03] p-4 text-center text-xs leading-relaxed text-[hsl(var(--muted))]">
            <Upload className="mx-auto h-8 w-8 text-[hsl(var(--muted))]" aria-hidden />
            <p className="font-medium text-[hsl(var(--foreground))]">No datasets in this workspace</p>
            <p>Drop files below or use <span className="font-mono text-white/80">Choose folder</span> to register parquet, CSV, or JSON in one step.</p>
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          {err && <div className="text-xs text-red-300">{err}</div>}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="sr-only"
            aria-label="Upload data files"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : []
              e.target.value = ''
              void uploadFiles(files)
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Upload folder of data files"
            {...({ webkitdirectory: '' } as object)}
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : []
              e.target.value = ''
              void uploadFiles(files)
            }}
          />

          <button
            type="button"
            onDragEnter={(e) => {
              e.preventDefault()
              setDragOver(true)
              setDropzoneExpanded(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOver(false)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(false)
              const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
              void uploadFiles(files)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-2 text-center text-xs transition',
              dropzoneExpanded || dragOver ? 'py-6' : 'py-2',
              dragOver
                ? 'border-[hsl(var(--accent))] bg-white/10'
                : 'border-white/20 bg-white/[0.03] hover:border-white/30',
            )}
          >
            <Upload className={cn('text-[hsl(var(--muted))]', dropzoneExpanded || dragOver ? 'mb-2 h-6 w-6' : 'h-4 w-4')} />
            {(dropzoneExpanded || dragOver) && (
              <>
                <span className="font-medium text-[hsl(var(--foreground))]">Drop files here</span>
                <span className="mt-1 text-[hsl(var(--muted))]">or click to choose files</span>
              </>
            )}
            {!dropzoneExpanded && !dragOver && (
              <span className="text-[hsl(var(--muted))]">Upload files — drop or click</span>
            )}
          </button>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => folderInputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="mr-2 h-4 w-4" />
            )}
            Choose folder
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden p-2">
        {many && list.length > 0 && (
          <div className="mb-2 flex shrink-0 flex-col gap-2">
            <Input
              placeholder="Search datasets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
            <label className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted))]">
              Sort
              <select
                className="h-7 flex-1 rounded-md border border-white/15 bg-black/30 px-1 text-xs"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
              >
                <option value="name">Name</option>
                <option value="rows">Rows</option>
                <option value="quality">Quality</option>
              </select>
            </label>
          </div>
        )}

        <div className="flex-1 space-y-1 overflow-auto">
          {q.isLoading && <div className="text-sm text-[hsl(var(--muted))]">Loading…</div>}
          {q.isError && <div className="text-sm text-red-300">{(q.error as Error).message}</div>}
          <ul className="space-y-1">
            {sortedFiltered.map((d) => {
              const active = activeDatasetId === d.dataset_id
              const sev = qualityScoreSeverity(d.quality_score ?? null)
              const dot =
                sev === 'critical'
                  ? 'bg-[hsl(var(--severity-critical))]'
                  : sev === 'warning'
                    ? 'bg-[hsl(var(--severity-warning))]'
                    : d.quality_score != null
                      ? 'bg-[hsl(var(--severity-ok))]'
                      : 'bg-white/20'
              return (
                <li key={d.dataset_id}>
                  <button
                    type="button"
                    title={`${d.dataset_id} — ${d.source_path}`}
                    onClick={() => setActiveDatasetId(d.dataset_id)}
                    className={cn(
                      'flex w-full flex-col rounded-md border border-transparent px-2 py-2 text-left text-sm transition',
                      active ? 'border-white/15 bg-white/10 pl-[10px] shadow-inner' : 'hover:bg-white/5',
                      active && 'border-l-2 border-l-[hsl(var(--accent))] pl-2',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full', dot)}
                        title={d.quality_score != null ? `Quality ${d.quality_score}` : 'Not profiled'}
                      />
                      <span className="truncate font-medium">{stripFileExtension(d.name)}</span>
                      <span className="ml-auto shrink-0 rounded border border-white/10 px-1 font-mono text-[10px] uppercase text-[hsl(var(--muted))]">
                        {formatDatasetFormat(d.format)}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-4 text-[10px] text-[hsl(var(--muted))]">
                      <span className="tabular-nums">{formatCount(d.row_count)}</span> ·{' '}
                      <span className="tabular-nums">{formatBytes(d.file_size_bytes)}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </aside>
  )
}

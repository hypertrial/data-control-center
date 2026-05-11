import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { Database, FolderOpen, Loader2, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

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

export function DatasetSidebar() {
  const qc = useQueryClient()
  const { activeDatasetId, setActiveDatasetId } = useUiStore()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const q = useQuery({
    queryKey: ['datasets'],
    queryFn: api.listDatasets,
  })

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

  return (
    <aside className="flex h-full w-72 flex-col border-r border-white/10 bg-[hsl(var(--card))]">
      <div className="border-b border-white/10 px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Database className="h-4 w-4" />
          Datasets
        </div>
        <div className="mt-3 space-y-2">
          {err && <div className="text-xs text-red-300">{err}</div>}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              const list = e.target.files ? Array.from(e.target.files) : []
              e.target.value = ''
              void uploadFiles(list)
            }}
          />
          {/* Chromium / Safari: directory picker; not in narrow React DOM typings */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            {...({ webkitdirectory: '' } as object)}
            onChange={(e) => {
              const list = e.target.files ? Array.from(e.target.files) : []
              e.target.value = ''
              void uploadFiles(list)
            }}
          />

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(false)
              const list = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
              void uploadFiles(list)
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs transition',
              dragOver
                ? 'border-[hsl(var(--accent))] bg-white/10'
                : 'border-white/20 bg-white/[0.03] hover:border-white/30',
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mb-2 h-6 w-6 text-[hsl(var(--muted))]" />
            <span className="font-medium text-[hsl(var(--foreground))]">Drop files here</span>
            <span className="mt-1 text-[hsl(var(--muted))]">or click to choose files</span>
          </div>

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
      <div className="flex-1 overflow-auto p-2">
        {q.isLoading && <div className="text-sm text-[hsl(var(--muted))]">Loading…</div>}
        {q.isError && (
          <div className="text-sm text-red-300">{(q.error as Error).message}</div>
        )}
        <ul className="space-y-1">
          {(q.data ?? []).map((d) => (
            <li key={d.dataset_id}>
              <button
                type="button"
                onClick={() => setActiveDatasetId(d.dataset_id)}
                className={cn(
                  'flex w-full flex-col rounded-md px-2 py-2 text-left text-sm transition',
                  activeDatasetId === d.dataset_id ? 'bg-white/10' : 'hover:bg-white/5',
                )}
              >
                <span className="truncate font-medium">{d.name}</span>
                <span className="truncate text-xs text-[hsl(var(--muted))]">{d.dataset_id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

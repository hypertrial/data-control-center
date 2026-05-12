import { useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Loader2, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'

/** Mirrors backend `SUPPORTED_EXTENSIONS` for client-side filtering. */
const UPLOAD_EXT = new Set(['.csv', '.tsv', '.parquet', '.json', '.jsonl', '.ndjson'])

export const ACCEPT_ATTR = '.csv,.tsv,.parquet,.json,.jsonl,.ndjson'

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

export function filterSupportedFiles(files: File[]): File[] {
  return files.map(normalizeUploadFile).filter((f) => UPLOAD_EXT.has(extOf(f.name)))
}

type Props = {
  className?: string
}

export function DatasetDropzone({ className }: Props) {
  const qc = useQueryClient()
  const setActiveDatasetId = useUiStore((s) => s.setActiveDatasetId)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

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
          toast.success(`Registered ${rows.length} file(s).`)
        }
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [qc, setActiveDatasetId],
  )

  return (
    <div className={cn('space-y-2', className)}>
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
          'flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center text-xs transition',
          dragOver
            ? 'border-[hsl(var(--accent))] bg-white/10'
            : 'border-border-default bg-white/[0.03] hover:border-border-accent',
        )}
      >
        <Upload className={cn('mb-2 h-8 w-8 text-fg-muted', dragOver && 'text-[hsl(var(--accent))]')} />
        <span className="font-medium text-fg">Drop files here</span>
        <span className="mt-1 text-fg-muted">or click to choose files</span>
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
  )
}

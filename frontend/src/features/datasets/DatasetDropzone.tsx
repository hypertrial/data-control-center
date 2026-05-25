import { Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TABULAR_ACCEPT_ATTR } from '@/features/datasets/uploadFiles'

const EMPTY_PICK_MESSAGE = 'No file was selected. Try drag-and-drop or choose files again.'

function filesFromInput(files: FileList | null): File[] {
  return files ? Array.from(files) : []
}

function pickFiles(files: File[], onFilesPicked: (files: File[]) => void) {
  if (!files.length) {
    toast.error(EMPTY_PICK_MESSAGE)
    return
  }
  onFilesPicked(files)
}

type Props = {
  className?: string
  busy?: boolean
  onFilesPicked: (files: File[]) => void
  onFolderPicked?: (files: File[]) => void
}

export function DatasetDropzone({ className, busy = false, onFilesPicked, onFolderPicked }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={TABULAR_ACCEPT_ATTR}
        className="sr-only"
        aria-label="Upload data files"
        onChange={(e) => {
          const files = filesFromInput(e.target.files)
          e.target.value = ''
          pickFiles(files, onFilesPicked)
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept={TABULAR_ACCEPT_ATTR}
        className="sr-only"
        aria-label="Upload folder of data files"
        {...({ webkitdirectory: '' } as object)}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          e.target.value = ''
          ;(onFolderPicked ?? onFilesPicked)(files)
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
          pickFiles(filesFromInput(e.dataTransfer.files), onFilesPicked)
        }}
        onClick={() => !busy && fileInputRef.current?.click()}
        disabled={busy}
        className={cn(
          'flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center text-xs transition',
          busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
          dragOver
            ? 'border-[hsl(var(--accent))] bg-white/10'
            : 'border-border-default bg-white/[0.03] hover:border-border-accent',
        )}
      >
        {busy ? (
          <Loader2 className="mb-2 h-8 w-8 animate-spin text-fg-muted" aria-hidden />
        ) : (
          <Upload className={cn('mb-2 h-8 w-8 text-fg-muted', dragOver && 'text-[hsl(var(--accent))]')} />
        )}
        <span className="font-medium text-fg">{busy ? 'Uploading…' : 'Drop files here'}</span>
        <span className="mt-1 text-fg-muted">{busy ? 'Please wait' : 'or click to choose files'}</span>
        <span className="mt-1 text-[10px] text-fg-muted">
          CSV, TSV, Parquet, JSON, JSONL, NDJSON — use Import DuckDB for .duckdb files
        </span>
      </button>

      {onFolderPicked ? (
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
            <Upload className="mr-2 h-4 w-4" />
          )}
          Choose folder
        </Button>
      ) : null}
    </div>
  )
}

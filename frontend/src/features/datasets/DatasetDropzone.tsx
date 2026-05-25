import { Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ACCEPT_ATTR } from '@/features/datasets/uploadFiles'

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
        accept={ACCEPT_ATTR}
        className="sr-only"
        aria-label="Upload data files"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          e.target.value = ''
          onFilesPicked(files)
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
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
          const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
          onFilesPicked(files)
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
        <span className="mt-1 text-[10px] text-fg-muted">CSV, TSV, Parquet, JSON, JSONL, NDJSON, DuckDB</span>
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

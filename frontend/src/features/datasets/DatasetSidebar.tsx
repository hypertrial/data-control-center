import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { Database, FolderOpen, Loader2 } from 'lucide-react'
import { useState } from 'react'

export function DatasetSidebar() {
  const qc = useQueryClient()
  const { activeDatasetId, setActiveDatasetId } = useUiStore()
  const [filePath, setFilePath] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['datasets'],
    queryFn: api.listDatasets,
  })

  return (
    <aside className="flex h-full w-72 flex-col border-r border-white/10 bg-[hsl(var(--card))]">
      <div className="border-b border-white/10 px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Database className="h-4 w-4" />
          Datasets
        </div>
        <div className="mt-3 space-y-2">
          {err && <div className="text-xs text-red-300">{err}</div>}
          <Input
            placeholder="Absolute path to file…"
            value={filePath}
            onChange={(e) => {
              setErr(null)
              setFilePath(e.target.value)
            }}
          />
          <Button
            className="w-full"
            disabled={!filePath || busy}
            onClick={async () => {
              setBusy(true)
              setErr(null)
              try {
                const row = await api.registerFile(filePath)
                await qc.invalidateQueries({ queryKey: ['datasets'] })
                setActiveDatasetId(row.dataset_id)
                setFilePath('')
              } catch (e) {
                setErr((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add file'}
          </Button>
          <Input
            placeholder="Absolute path to folder…"
            value={folderPath}
            onChange={(e) => {
              setErr(null)
              setFolderPath(e.target.value)
            }}
          />
          <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted))]">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              className="accent-[hsl(var(--accent))]"
            />
            Recursive
          </label>
          <Button
            variant="outline"
            className="w-full"
            disabled={!folderPath || busy}
            onClick={async () => {
              setBusy(true)
              setErr(null)
              try {
                const rows = await api.registerFolder(folderPath, recursive)
                await qc.invalidateQueries({ queryKey: ['datasets'] })
                if (rows.length) setActiveDatasetId(rows[rows.length - 1]!.dataset_id)
                setFolderPath('')
              } catch (e) {
                setErr((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            Add folder
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

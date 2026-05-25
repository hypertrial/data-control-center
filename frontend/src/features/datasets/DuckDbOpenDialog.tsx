import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { useState } from 'react'
import { toast } from 'sonner'

type Props = {
  open: boolean
  hint?: string
  onClose: () => void
  onOpened: (sourceId: string, filename: string) => void
}

export function DuckDbOpenDialog({ open, hint, onClose, onOpened }: Props) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)

  const runNativePick = async () => {
    setBusy(true)
    try {
      const opened = await api.pickLocalDuckDb()
      onOpened(opened.source_id, opened.filename)
      setPath('')
      onClose()
    } catch (e) {
      const msg = (e as Error).message
      if (!/cancel/i.test(msg)) toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    const trimmed = path.trim()
    if (!trimmed) {
      toast.error('Choose a .duckdb file or enter its absolute path.')
      return
    }
    setBusy(true)
    try {
      const opened = await api.openLocalDuckDb(trimmed)
      onOpened(opened.source_id, opened.filename)
      setPath('')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent title="Open DuckDB from disk" className="max-w-lg">
        <div className="space-y-3">
          {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
          <p className="text-sm text-fg-muted">
            Large databases open in place (no copy). The file must live under an allowed registration root for
            this workstation.
          </p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void runNativePick()}>
            Choose file…
          </Button>
          <Input
            aria-label="Absolute path to DuckDB file"
            placeholder="/path/to/database.duckdb"
            value={path}
            disabled={busy}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={busy} disabled={busy} onClick={() => void submit()}>
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

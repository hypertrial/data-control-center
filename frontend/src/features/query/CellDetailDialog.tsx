import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { CellDetail } from '@/features/query/useSqlResultsGrid'

export type CellDetailDialogProps = {
  cellDetail: CellDetail | null
  onClose: () => void
}

export function CellDetailDialog({ cellDetail, onClose }: CellDetailDialogProps) {
  return (
    <Dialog open={!!cellDetail} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={cellDetail?.title} className="max-h-[80vh] max-w-lg overflow-auto">
        <pre className="whitespace-pre-wrap break-all font-mono text-xs text-white/90">{cellDetail?.body}</pre>
      </DialogContent>
    </Dialog>
  )
}

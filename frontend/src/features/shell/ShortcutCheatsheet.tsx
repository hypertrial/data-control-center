import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useUiStore } from '@/store/uiStore'

const ROWS: Array<{ keys: string; action: string }> = [
  { keys: '⌘ K', action: 'Open command palette' },
  { keys: '?', action: 'Show this cheatsheet' },
  { keys: '/', action: 'Focus dataset search in sidebar' },
  { keys: 'g c', action: 'Go to Columns' },
  { keys: 'g s', action: 'Go to Samples' },
  { keys: 'g a', action: 'Go to Ask' },
  { keys: 'g y', action: 'Go to SQL' },
  { keys: 'r', action: 'Invalidate queries / soft refresh' },
  { keys: '⌘ Enter', action: 'Ask: submit · SQL: run query / selection' },
  { keys: '⌘ .', action: 'Ask: stop streaming' },
  { keys: '⌘ ,', action: 'Ask: open settings popover' },
  { keys: '⌘ Shift F', action: 'SQL: format query' },
  { keys: '⌘ S', action: 'SQL: open save dialog' },
]

export function ShortcutCheatsheet() {
  const open = useUiStore((s) => s.shortcutSheetOpen)
  const setOpen = useUiStore((s) => s.setShortcutSheetOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Keyboard shortcuts" className="max-w-md">
        <p className="text-sm text-fg-muted">
          Global shortcuts are ignored while typing in inputs or textareas. The SQL editor also
          handles ⌘ Enter, ⌘ Shift F, and ⌘ S locally.
        </p>
        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">Application keyboard shortcuts</caption>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.action} className="border-t border-border-default">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-fg">
                  {r.action}
                </th>
                <td className="py-2 text-right">
                  <kbd className="rounded border border-border-default bg-surface-elevated px-2 py-0.5 font-mono text-xs text-fg-muted">
                    {r.keys}
                  </kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  )
}

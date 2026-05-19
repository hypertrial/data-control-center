import { MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/format'
import type { AskOptionsFocus } from '@/features/ask/askComposerState'
import { scopeSummary, type AskScope } from '@/features/ask/askComposerState'
import { cn } from '@/lib/utils'

export function AskContextBar({
  modelLabel,
  maxRows,
  scope,
  datasetCount,
  profileUpdatedAt,
  onOpenSettings,
  onRefreshProfile,
  refreshDisabled,
  onOpenChats,
  showChatsButton,
  hidden,
}: {
  modelLabel: string
  maxRows: number
  scope: AskScope
  datasetCount: number
  profileUpdatedAt?: number
  onOpenSettings: (focus: AskOptionsFocus | null) => void
  onRefreshProfile?: () => void
  refreshDisabled?: boolean
  onOpenChats?: () => void
  showChatsButton?: boolean
  hidden?: boolean
}) {
  if (hidden) return null

  const scopeLabel = scopeSummary(scope, datasetCount)

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-default/60 px-1 py-2"
      data-testid="ask-context-bar"
    >
      {showChatsButton && onOpenChats ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1 md:hidden"
          onClick={onOpenChats}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Chats
        </Button>
      ) : null}

      <button
        type="button"
        className={chipClass}
        onClick={() => onOpenSettings('model')}
        title="Model"
      >
        {modelLabel}
      </button>
      <button
        type="button"
        className={chipClass}
        onClick={() => onOpenSettings('rows')}
        title="Max preview rows"
      >
        {maxRows} rows
      </button>
      {datasetCount > 0 ? (
        <button
          type="button"
          className={chipClass}
          onClick={() => onOpenSettings('scope')}
          title="Dataset scope"
        >
          {scopeLabel}
        </button>
      ) : null}

      {profileUpdatedAt != null ? (
        <span className="text-[10px] text-fg-muted">
          Profile {formatRelativeTime(profileUpdatedAt)}
        </span>
      ) : null}

      {onRefreshProfile ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 text-xs"
          disabled={refreshDisabled}
          onClick={onRefreshProfile}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh profile
        </Button>
      ) : null}
    </div>
  )
}

const chipClass = cn(
  'rounded-full border border-border-default bg-black/20 px-2 py-0.5',
  'text-[11px] text-fg-muted hover:bg-white/10 hover:text-fg',
)

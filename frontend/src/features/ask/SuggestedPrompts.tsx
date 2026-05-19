import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { DatasetProfile } from '@/api/types'
import { Button } from '@/components/ui/button'
import { buildSuggestedPrompts } from '@/features/ask/askPrompts'

export function SuggestedPrompts({
  profile,
  onPick,
  collapsed = false,
  compact = false,
}: {
  profile: DatasetProfile | undefined
  onPick: (text: string) => void
  collapsed?: boolean
  /** Strip above composer (single row when collapsed). */
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(!collapsed)

  if (!profile) return null

  const uniq = buildSuggestedPrompts(profile)
  if (uniq.length === 0) return null

  const showCollapsed = collapsed && !expanded

  return (
    <div className="shrink-0" data-testid="suggested-prompts">
      {!compact ? (
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
          Suggested
        </div>
      ) : null}
      <div
        className={
          showCollapsed
            ? 'flex items-center gap-1 overflow-x-auto'
            : compact
              ? 'flex max-h-20 flex-wrap gap-1.5 overflow-y-auto'
              : 'flex max-h-24 flex-wrap gap-2 overflow-y-auto'
        }
      >
        {uniq.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="sm"
            className={
              showCollapsed || compact
                ? 'h-7 shrink-0 whitespace-nowrap text-xs'
                : 'h-auto max-w-full whitespace-normal py-1.5 text-left text-xs'
            }
            onClick={() => onPick(p)}
          >
            {p}
          </Button>
        ))}
      </div>
      {collapsed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-6 gap-0.5 px-1 text-[10px] text-fg-muted"
          aria-label={expanded ? 'Collapse suggested prompts' : 'Expand suggested prompts'}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Less' : 'More prompts'}
        </Button>
      ) : null}
    </div>
  )
}


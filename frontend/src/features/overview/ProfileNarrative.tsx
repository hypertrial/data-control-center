import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const COLLAPSE_LINE_THRESHOLD = 280

export function ProfileNarrative({ narrative }: { narrative: string }) {
  const trimmed = narrative.trim()
  const [expanded, setExpanded] = useState(false)
  if (!trimmed) return null

  const long = trimmed.length > COLLAPSE_LINE_THRESHOLD

  return (
    <div className="rounded-xl border border-border-default bg-white/[0.04] p-4">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--fg-muted))]">
        Profile summary
      </div>
      <div
        className={cn(
          'prose prose-invert prose-sm max-w-none text-white/90 [&_p]:my-2 [&_ul]:my-2',
          long && !expanded && 'line-clamp-4',
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
      </div>
      {long ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-7 px-2 text-xs text-[hsl(var(--fg-muted))]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      ) : null}
    </div>
  )
}

import { MessageSquarePlus, Sparkles } from 'lucide-react'
import type { DatasetProfile } from '@/api/types'
import { Button } from '@/components/ui/button'
import { buildSuggestedPrompts } from '@/features/ask/askPrompts'

export function AskHero({
  profile,
  onPickPrompt,
  onStartNewChat,
}: {
  profile: DatasetProfile | undefined
  onPickPrompt: (text: string) => void
  onStartNewChat?: () => void
}) {
  const prompts = profile ? buildSuggestedPrompts(profile) : []

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8"
      data-testid="ask-hero"
    >
      <div className="w-full max-w-2xl space-y-6 text-center">
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border-default bg-white/5">
            <Sparkles className="h-6 w-6 text-[hsl(var(--accent))]" aria-hidden />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-fg">Ask your data</h2>
          <p className="mx-auto max-w-md text-sm text-fg-muted">
            Ask in plain language. The assistant drafts read-only SQL, runs it locally, and summarizes
            the result.
          </p>
        </div>

        {prompts.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {prompts.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                className="h-auto min-h-[3rem] whitespace-normal px-3 py-2.5 text-left text-xs leading-snug"
                onClick={() => onPickPrompt(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-fg-muted">
          {onStartNewChat ? (
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onStartNewChat}>
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Start new chat
            </Button>
          ) : null}
          <span>Tip: use ⌘+Enter to send · ↑ to recall your last question</span>
        </div>
      </div>
    </div>
  )
}

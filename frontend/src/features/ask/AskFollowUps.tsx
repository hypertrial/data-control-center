import { Button } from '@/components/ui/button'

export function AskFollowUps({
  prompts,
  onPick,
}: {
  prompts: string[]
  onPick: (text: string) => void
}) {
  if (prompts.length === 0) return null

  return (
    <div className="shrink-0 space-y-1.5 px-1" data-testid="ask-follow-ups">
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">Follow up</div>
      <div className="flex flex-wrap gap-1.5">
        {prompts.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto max-w-full whitespace-normal py-1 text-left text-xs"
            onClick={() => onPick(p)}
          >
            {p}
          </Button>
        ))}
      </div>
    </div>
  )
}

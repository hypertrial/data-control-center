import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AskSqlAttempt, AskStageEntry } from '@/hooks/useAskStream'
import { cn } from '@/lib/utils'

function stageLabel(name: string) {
  switch (name) {
    case 'context':
      return 'Context'
    case 'draft_sql':
      return 'Draft SQL'
    case 'execute':
      return 'Run query'
    case 'retry':
      return 'Retry'
    case 'summarize':
      return 'Summarize'
    default:
      return name
  }
}

export function AskStageTimeline({
  stages,
  sqlAttempts,
  totalMs,
  busy,
}: {
  stages: AskStageEntry[]
  sqlAttempts: AskSqlAttempt[]
  totalMs: number | null
  busy: boolean
}) {
  const [attemptsOpen, setAttemptsOpen] = useState(false)

  const lastStage = stages.length ? stages[stages.length - 1]?.name : null

  return (
    <div className="space-y-2 rounded-lg border border-border-default bg-black/20 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        {['context', 'draft_sql', 'execute', 'summarize'].map((name) => {
          const hit = stages.filter((s) => s.name === name)
          const active = busy && lastStage === name
          const done = hit.length > 0 && (!busy || lastStage !== name)
          return (
            <span
              key={name}
              className={cn(
                'rounded-full border px-2 py-0.5 font-medium',
                active && 'border-[hsl(var(--accent))] bg-white/10 text-white',
                done && !active && 'border-border-default text-fg-muted',
                !done && !active && 'border-border-default/50 text-fg-muted/60',
              )}
            >
              {stageLabel(name)}
            </span>
          )
        })}
        {typeof totalMs === 'number' ? (
          <span className="ml-auto tabular-nums text-fg-muted">{totalMs} ms</span>
        ) : null}
      </div>
      {sqlAttempts.length > 0 ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1 text-fg-muted"
            onClick={() => setAttemptsOpen((v) => !v)}
          >
            {attemptsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Attempts ({sqlAttempts.length})
          </Button>
          {attemptsOpen ? (
            <ul className="mt-1 max-h-40 space-y-2 overflow-y-auto rounded border border-border-default bg-black/30 p-2 font-mono text-[10px] text-red-200/90">
              {sqlAttempts.map((a) => (
                <li key={`${a.attempt}-${a.sql.slice(0, 20)}`}>
                  <div className="text-fg-muted">Attempt {a.attempt}</div>
                  <div className="max-h-16 overflow-y-auto whitespace-pre-wrap text-white/80">{a.error}</div>
                  <div className="mt-0.5 text-fg-muted">{a.sql.slice(0, 240)}{a.sql.length > 240 ? '…' : ''}</div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

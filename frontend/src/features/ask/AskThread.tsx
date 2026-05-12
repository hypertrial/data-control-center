import { useEffect, useRef } from 'react'
import type { AskTurn as AskTurnType } from '@/api/types'
import { AskTurnCard, StreamingAskCard } from '@/features/ask/AskTurn'
import type { AskCallState } from '@/hooks/useAskStream'

export function AskThread({
  turns,
  streamingQuestion,
  streaming,
  busy,
  onOpenInSql,
  onRetry,
}: {
  turns: AskTurnType[]
  streamingQuestion: string | null
  streaming: AskCallState | null
  busy: boolean
  onOpenInSql: (sql: string) => void
  onRetry: (q: string) => void
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns.length, streaming?.answer, streaming?.error, streaming?.sql, busy])

  const showStreaming =
    streaming &&
    streamingQuestion &&
    (busy ||
      streaming.answer ||
      streaming.error ||
      streaming.sql ||
      streaming.queryResult ||
      streaming.stages.length > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-4 pr-1">
      {turns.map((t) => (
        <AskTurnCard key={t.turn_id} turn={t} onOpenInSql={onOpenInSql} onRetry={onRetry} />
      ))}
      {showStreaming && streaming && streamingQuestion ? (
        <StreamingAskCard
          question={streamingQuestion}
          busy={busy}
          stages={streaming.stages}
          sqlAttempts={streaming.sqlAttempts}
          sql={streaming.sql}
          explanation={streaming.explanation}
          queryResult={streaming.queryResult}
          answer={streaming.answer}
          error={streaming.error}
          streamingPreview={streaming.streamingAnswerPreview}
          model={streaming.model}
          totalMs={streaming.totalMs}
          onOpenInSql={onOpenInSql}
          onRetry={onRetry}
        />
      ) : null}
      <div ref={bottomRef} />
    </div>
  )
}

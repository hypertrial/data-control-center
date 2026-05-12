import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { AskTurn as AskTurnType } from '@/api/types'
import { AskTurnCard, StreamingAskCard } from '@/features/ask/AskTurn'
import { Button } from '@/components/ui/button'
import type { AskCallState } from '@/hooks/useAskStream'

const NEAR_BOTTOM_PX = 96
/** Extra scroll padding so the last bubble clears the composer/footer */
const THREAD_BOTTOM_PADDING = 'pb-32'

function isNearBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}

function maxScrollTop(el: HTMLDivElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

export function AskThread({
  conversationId,
  turns,
  streamingQuestion,
  streaming,
  busy,
  onOpenInSql,
  onRetry,
}: {
  conversationId: string | null
  turns: AskTurnType[]
  streamingQuestion: string | null
  streaming: AskCallState | null
  busy: boolean
  onOpenInSql: (sql: string) => void
  onRetry: (q: string) => void
}) {
  const threadRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const prevHeightRef = useRef(0)
  const prevConversationIdRef = useRef<string | null | undefined>(undefined)
  const prevStreamingQuestionRef = useRef<string | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const onScroll = useCallback(() => {
    const el = threadRef.current
    if (!el) return
    stickToBottomRef.current = isNearBottom(el)
    if (stickToBottomRef.current) setShowJumpToLatest(false)
  }, [])

  const scrollThreadToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = threadRef.current
    if (!el) return
    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = maxScrollTop(el)
    }
    prevHeightRef.current = el.scrollHeight
  }, [])

  const showStreaming =
    streaming &&
    streamingQuestion &&
    (busy ||
      streaming.answer ||
      streaming.error ||
      streaming.sql ||
      streaming.queryResult ||
      streaming.stages.length > 0)

  // Switching conversations: always start pinned to the bottom.
  useLayoutEffect(() => {
    if (prevConversationIdRef.current === conversationId) return
    prevConversationIdRef.current = conversationId
    prevStreamingQuestionRef.current = null
    stickToBottomRef.current = true
    setShowJumpToLatest(false)
    const el = threadRef.current
    if (el) {
      el.scrollTop = maxScrollTop(el)
      prevHeightRef.current = el.scrollHeight
    }
  }, [conversationId])

  // New outbound question: smooth scroll and re-pin.
  useLayoutEffect(() => {
    if (!streamingQuestion || streamingQuestion === prevStreamingQuestionRef.current) return
    prevStreamingQuestionRef.current = streamingQuestion
    stickToBottomRef.current = true
    setShowJumpToLatest(false)
    requestAnimationFrame(() => scrollThreadToBottom('smooth'))
  }, [streamingQuestion, scrollThreadToBottom])

  // Streaming / turns growth: pin only if user stayed near the bottom.
  useLayoutEffect(() => {
    const el = threadRef.current
    if (!el) return

    if (stickToBottomRef.current) {
      el.scrollTop = maxScrollTop(el)
    } else if (el.scrollHeight > prevHeightRef.current) {
      setShowJumpToLatest(true)
    }
    prevHeightRef.current = el.scrollHeight
  }, [turns, streaming, busy])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={threadRef}
        data-testid="ask-thread-scroll"
        onScroll={onScroll}
        className={`flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1 ${THREAD_BOTTOM_PADDING}`}
      >
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
      </div>

      {showJumpToLatest ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="pointer-events-auto shadow-md"
            onClick={() => {
              stickToBottomRef.current = true
              setShowJumpToLatest(false)
              scrollThreadToBottom('smooth')
            }}
          >
            Jump to latest message
          </Button>
        </div>
      ) : null}
    </div>
  )
}

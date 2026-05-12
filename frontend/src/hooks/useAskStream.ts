import { useCallback, useRef, useState } from 'react'
import type { AgentAskRequest, AgentStreamEvent, QueryResult } from '@/api/types'
import { askAgentStream } from '@/api/client'

export type AskStageEntry = {
  name: string
  at: number
  attempt?: number
  elapsed_ms?: number
}

export type AskSqlAttempt = { sql: string; error: string | null; attempt: number }

export type AskCallState = {
  stages: AskStageEntry[]
  sqlAttempts: AskSqlAttempt[]
  sql: string | null
  explanation: string | null
  queryResult: QueryResult | null
  answer: string | null
  error: string | null
  model: string | null
  totalMs: number | null
  turnId: string | null
  conversationId: string | null
  seq: number | null
  streamingAnswerPreview: string
  summarizing: boolean
}

const emptyCall: AskCallState = {
  stages: [],
  sqlAttempts: [],
  sql: null,
  explanation: null,
  queryResult: null,
  answer: null,
  error: null,
  model: null,
  totalMs: null,
  turnId: null,
  conversationId: null,
  seq: null,
  streamingAnswerPreview: '',
  summarizing: false,
}

export function useAskStream() {
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<AskCallState | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setCurrent(null)
  }, [])

  const run = useCallback(async (body: AgentAskRequest) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    setCurrent({ ...emptyCall })
    try {
      await askAgentStream(body, (ev: AgentStreamEvent) => {
        setCurrent((s) => {
          const base: AskCallState = s ?? { ...emptyCall }
          switch (ev.type) {
            case 'meta':
              return {
                ...base,
                model: typeof ev.data?.model === 'string' ? ev.data.model : base.model,
              }
            case 'stage':
              return {
                ...base,
                stages: [
                  ...base.stages,
                  {
                    name: ev.data.name,
                    at: Date.now(),
                    attempt: ev.data.attempt,
                    elapsed_ms: ev.data.elapsed_ms,
                  },
                ],
                summarizing: ev.data.name === 'summarize' ? true : base.summarizing,
              }
            case 'sql_attempt':
              return {
                ...base,
                sqlAttempts: [
                  ...base.sqlAttempts,
                  {
                    sql: ev.data.sql,
                    error: ev.data.error ?? null,
                    attempt: ev.data.attempt,
                  },
                ],
              }
            case 'sql':
              return {
                ...base,
                sql: ev.data.sql,
                explanation: ev.data.explanation ?? null,
              }
            case 'query_result':
              return { ...base, queryResult: ev.data }
            case 'token':
              if (!base.summarizing) return base
              return {
                ...base,
                streamingAnswerPreview: base.streamingAnswerPreview + (ev.data.text ?? ''),
              }
            case 'answer':
              return {
                ...base,
                answer: ev.data.answer,
                streamingAnswerPreview: '',
                summarizing: false,
              }
            case 'error':
              return {
                ...base,
                error: ev.data.message,
                sql: ev.data.sql ?? base.sql,
                explanation: ev.data.explanation ?? base.explanation,
                queryResult: ev.data.query_result ?? base.queryResult,
                streamingAnswerPreview: '',
                summarizing: false,
              }
            case 'timing':
              return {
                ...base,
                totalMs: typeof ev.data.total_ms === 'number' ? ev.data.total_ms : base.totalMs,
              }
            case 'turn':
              return {
                ...base,
                turnId: ev.data.turn_id,
                conversationId: ev.data.conversation_id,
                seq: ev.data.seq,
              }
            case 'done':
              return base
            default:
              return base
          }
        })
      }, { signal: ac.signal })
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return
      }
      setCurrent((s) => ({
        ...(s ?? { ...emptyCall }),
        error: (e as Error).message || 'Stream failed',
      }))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
  }, [])

  return { busy, current, run, reset, cancel }
}

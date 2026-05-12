import { useCallback, useRef, useState } from 'react'
import type { AgentAskRequest, AgentStreamEvent, QueryResult } from '@/api/types'
import { askAgentStream } from '@/api/client'

export type AskStreamState = {
  busy: boolean
  error: string | null
  tokenBuffer: string
  answer: string | null
  sql: string | null
  explanation: string | null
  queryResult: QueryResult | null
  model: string | null
}

const initial: AskStreamState = {
  busy: false,
  error: null,
  tokenBuffer: '',
  answer: null,
  sql: null,
  explanation: null,
  queryResult: null,
  model: null,
}

export function useAskStream() {
  const [state, setState] = useState<AskStreamState>(initial)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(initial)
  }, [])

  const run = useCallback(async (body: AgentAskRequest) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setState({
      ...initial,
      busy: true,
    })
    try {
      await askAgentStream(body, (ev: AgentStreamEvent) => {
        setState((s) => {
          switch (ev.type) {
            case 'meta':
              return {
                ...s,
                model: typeof ev.data?.model === 'string' ? ev.data.model : s.model,
              }
            case 'token':
              return { ...s, tokenBuffer: s.tokenBuffer + (ev.data.text ?? '') }
            case 'sql':
              return {
                ...s,
                sql: ev.data.sql,
                explanation: ev.data.explanation ?? null,
              }
            case 'query_result':
              return { ...s, queryResult: ev.data }
            case 'answer':
              return { ...s, answer: ev.data.answer, tokenBuffer: '' }
            case 'error':
              return {
                ...s,
                error: ev.data.message,
                sql: ev.data.sql ?? s.sql,
                explanation: ev.data.explanation ?? s.explanation,
                queryResult: ev.data.query_result ?? s.queryResult,
              }
            case 'done':
              return { ...s, busy: false }
            default:
              return s
          }
        })
      }, { signal: ac.signal })
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return
      }
      setState((s) => ({
        ...s,
        error: (e as Error).message || 'Stream failed',
      }))
    } finally {
      setState((s) => ({ ...s, busy: false }))
      abortRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState((s) => ({ ...s, busy: false }))
  }, [])

  return { ...state, run, reset, cancel }
}

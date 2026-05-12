import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAskStream } from '@/hooks/useAskStream'

const h = vi.hoisted(() => ({ askAgentStream: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    askAgentStream: h.askAgentStream,
  }
})

describe('useAskStream', () => {
  beforeEach(() => {
    h.askAgentStream.mockReset()
  })

  it('records stage, sql_attempt, timing, and turn', async () => {
    h.askAgentStream.mockImplementation(async (_b, onEv) => {
      onEv({
        type: 'stage',
        data: { name: 'context' },
      } as never)
      onEv({
        type: 'sql_attempt',
        data: { sql: 'SELECT 1', error: 'bad', attempt: 1 },
      } as never)
      onEv({ type: 'timing', data: { total_ms: 120 } } as never)
      onEv({
        type: 'turn',
        data: { turn_id: 't1', conversation_id: 'c1', seq: 2 },
      } as never)
      onEv({ type: 'done', data: {} } as never)
    })
    const { result } = renderHook(() => useAskStream())
    await act(async () => {
      await result.current.run({ question: 'q' })
    })
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.current?.stages.map((s) => s.name)).toContain('context')
    expect(result.current.current?.sqlAttempts).toEqual([
      { sql: 'SELECT 1', error: 'bad', attempt: 1 },
    ])
    expect(result.current.current?.totalMs).toBe(120)
    expect(result.current.current?.turnId).toBe('t1')
    expect(result.current.current?.seq).toBe(2)
  })

  it('ignores token chunks until summarize stage', async () => {
    h.askAgentStream.mockImplementation(async (_b, onEv) => {
      onEv({ type: 'token', data: { text: 'no' } } as never)
      onEv({ type: 'stage', data: { name: 'summarize' } } as never)
      onEv({ type: 'token', data: { text: 'yes' } } as never)
      onEv({ type: 'done', data: {} } as never)
    })
    const { result } = renderHook(() => useAskStream())
    await act(async () => {
      await result.current.run({ question: 'q' })
    })
    expect(result.current.current?.streamingAnswerPreview).toBe('yes')
  })

  it('cancel interrupts stream without leaking busy state', async () => {
    h.askAgentStream.mockImplementation(async (_b, _on, opts) => {
      await new Promise<void>((resolve) => {
        opts?.signal?.addEventListener('abort', () => resolve())
      })
    })
    const { result } = renderHook(() => useAskStream())
    await act(async () => {
      const p = result.current.run({ question: 'x' })
      result.current.cancel()
      await p
    })
    expect(result.current.busy).toBe(false)
  })
})

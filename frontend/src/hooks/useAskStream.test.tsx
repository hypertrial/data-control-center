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

  it('overlapping runs keep busy until the newer stream finishes', async () => {
    const signals: AbortSignal[] = []
    h.askAgentStream.mockImplementation(async (_b, _on, opts) => {
      const signal = opts?.signal
      if (!signal) throw new Error('missing signal')
      signals.push(signal)
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          return
        }
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }
        signal.addEventListener('abort', onAbort)
        // Keep run alive until aborted or test settles via cancel.
      })
    })
    const { result } = renderHook(() => useAskStream())

    let run1: Promise<void>
    let run2: Promise<void>
    await act(async () => {
      run1 = result.current.run({ question: 'one' })
    })
    await act(async () => {
      run2 = result.current.run({ question: 'two' })
    })
    await waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[0]?.aborted).toBe(true)
    expect(result.current.busy).toBe(true)

    await act(async () => {
      result.current.cancel()
      await Promise.allSettled([run1!, run2!])
    })
    expect(signals[1]?.aborted).toBe(true)
    expect(result.current.busy).toBe(false)
  })

  it('ignores late errors from a superseded run', async () => {
    let rejectOlder: ((err: Error) => void) | null = null
    let resolveNewer: (() => void) | null = null
    h.askAgentStream
      .mockImplementationOnce(async () => {
        await new Promise<void>((_resolve, reject) => {
          rejectOlder = reject
        })
      })
      .mockImplementationOnce(async (_b, onEv) => {
        onEv({ type: 'answer', data: { answer: 'fresh' } } as never)
        await new Promise<void>((resolve) => {
          resolveNewer = resolve
        })
        onEv({ type: 'done', data: {} } as never)
      })

    const { result } = renderHook(() => useAskStream())
    let older: Promise<void>
    await act(async () => {
      older = result.current.run({ question: 'old' })
    })
    await act(async () => {
      void result.current.run({ question: 'new' })
    })
    await waitFor(() => expect(result.current.current?.answer).toBe('fresh'))

    await act(async () => {
      rejectOlder?.(new Error('stale failure'))
      await older!
    })
    expect(result.current.current?.answer).toBe('fresh')
    expect(result.current.current?.error).toBeNull()
    expect(result.current.busy).toBe(true)

    await act(async () => {
      resolveNewer?.()
    })
    await waitFor(() => expect(result.current.busy).toBe(false))
  })
})

import { describe, expect, it, vi } from 'vitest'
import { api, askAgentStream } from '@/api/client'
import { expectToken, installApiClientTestSession, jsonOk, textErr } from '@/test/apiClient'

installApiClientTestSession()

describe('ask api client', () => {
  it('ask conversations and turns API', async () => {
    const conv = {
      conversation_id: 'c1',
      title: 'T',
      dataset_ids: null as string[] | null,
      created_at: 'a',
      updated_at: 'b',
    }
    const turn = {
      turn_id: 't1',
      conversation_id: 'c1',
      seq: 1,
      question: 'q',
      attempts: [],
      created_at: 'x',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([conv]))
      .mockResolvedValueOnce(jsonOk(conv))
      .mockResolvedValueOnce(jsonOk(conv))
      .mockResolvedValueOnce({ ok: true, statusText: 'No Content', text: () => Promise.resolve('') } as Response)
      .mockResolvedValueOnce(jsonOk([turn]))
      .mockResolvedValueOnce({ ok: true, statusText: 'No Content', text: () => Promise.resolve('') } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await api.listAskConversations()
    await api.createAskConversation({ title: 'Hi' })
    await api.patchAskConversation('c1', { title: 'Ren' })
    await api.deleteAskConversation('c1')
    await api.listAskTurns('c1', 50)
    await api.deleteAskTurn('c1', 't1')

    expect(fetchMock).toHaveBeenCalledWith('/api/ask/conversations', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/ask/conversations', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/ask/conversations/c1', expect.objectContaining({ method: 'PATCH' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/ask/conversations/c1', expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/ask/conversations/c1/turns?limit=50', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/ask/conversations/c1/turns/t1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('askAgentStream parses SSE events across chunks', async () => {
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode('data: {"type":"meta","data":{"model":"m"}}\n'))
        controller.enqueue(enc.encode('\ndata: {"type":"answer","data":{"answer":"ok"}}\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: unknown[] = []
    await askAgentStream({ question: 'q' }, (ev) => events.push(ev))

    expect(events).toEqual([
      { type: 'meta', data: { model: 'm' } },
      { type: 'answer', data: { answer: 'ok' } },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/agent/ask/stream', expect.objectContaining({ method: 'POST' }))
    expectToken(fetchMock.mock.calls[0]![1] as RequestInit)
  })

  it('askAgentStream throws for HTTP and missing body errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textErr('stream failed')))
    await expect(askAgentStream({ question: 'q' }, () => {})).rejects.toThrow('stream failed')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: null } as Response))
    await expect(askAgentStream({ question: 'q' }, () => {})).rejects.toThrow('No response body')
  })
})

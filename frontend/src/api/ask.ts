import { API, apiFetch, handle, readApiError } from '@/api/transport'
import type {
  AgentAskRequest,
  AgentStreamEvent,
  AskConversation,
  AskConversationCreate,
  AskConversationPatch,
  AskTurn,
} from '@/api/types'

export const askApi = {
  listAskConversations: () => handle<AskConversation[]>(apiFetch(`${API}/ask/conversations`)),

  createAskConversation: (body: AskConversationCreate) =>
    handle<AskConversation>(
      apiFetch(`${API}/ask/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  patchAskConversation: (conversationId: string, body: AskConversationPatch) =>
    handle<AskConversation>(
      apiFetch(`${API}/ask/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  deleteAskConversation: async (conversationId: string) => {
    const r = await apiFetch(`${API}/ask/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    })
    if (!r.ok) throw new Error(await readApiError(r))
  },

  listAskTurns: (conversationId: string, limit = 100) =>
    handle<AskTurn[]>(
      apiFetch(
        `${API}/ask/conversations/${encodeURIComponent(conversationId)}/turns?limit=${encodeURIComponent(String(limit))}`,
      ),
    ),

  deleteAskTurn: async (conversationId: string, turnId: string) => {
    const r = await apiFetch(
      `${API}/ask/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}`,
      { method: 'DELETE' },
    )
    if (!r.ok) throw new Error(await readApiError(r))
  },
}

export async function askAgentStream(
  body: AgentAskRequest,
  onEvent: (ev: AgentStreamEvent) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const res = await apiFetch(`${API}/agent/ask/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: options?.signal,
  })
  if (!res.ok) {
    throw new Error(await readApiError(res))
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx = buf.indexOf('\n\n')
    while (idx >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      idx = buf.indexOf('\n\n')
      for (const line of chunk.split('\n')) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const json = s.slice(5).trim()
        if (!json) continue
        try {
          const ev = JSON.parse(json) as AgentStreamEvent
          if (ev && typeof ev === 'object' && 'type' in ev) onEvent(ev)
        } catch {
          // ignore malformed sse json
        }
      }
    }
  }
}

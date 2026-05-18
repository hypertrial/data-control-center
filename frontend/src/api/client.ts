import type {
  AgentAskRequest,
  AgentAskResponse,
  AgentStreamEvent,
  ApiError,
  AskConversation,
  AskConversationCreate,
  AskConversationPatch,
  AskTurn,
  DatasetProfile,
  DatasetSummary,
  JobCreateResponse,
  JobDetail,
  JobSummary,
  ProfileDiffResponse,
  ProfileHistoryEntry,
  QueryRequest,
  QueryResult,
  SampleResponse,
  SavedQuery,
  SavedQueryCreate,
  SavedQueryPatch,
} from '@/api/types'

const API = '/api'

async function readApiError(r: Response): Promise<string> {
  const text = await r.text()
  if (!text) return r.statusText || 'Request failed'
  try {
    const parsed = JSON.parse(text) as { error?: ApiError; detail?: string }
    if (parsed?.error?.message) return parsed.error.message
    if (typeof parsed?.detail === 'string') return parsed.detail
  } catch {
    // fall through to raw text
  }
  return text
}

async function handle<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    throw new Error(await readApiError(r))
  }
  return r.json() as Promise<T>
}

export const api = {
  health: () => handle<{ status: string }>(fetch(`${API}/health`)),

  listDatasets: () => handle<DatasetSummary[]>(fetch(`${API}/datasets`)),

  uploadDatasets: (files: File[]) => {
    const body = new FormData()
    for (const f of files) body.append('files', f)
    return handle<DatasetSummary[]>(
      fetch(`${API}/datasets/upload`, {
        method: 'POST',
        body,
      }),
    )
  },

  getProfile: (datasetId: string) =>
    handle<DatasetProfile>(fetch(`${API}/datasets/${datasetId}/profile`)),

  deleteDataset: async (datasetId: string) => {
    const r = await fetch(`${API}/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(await readApiError(r))
  },

  refreshProfile: (datasetId: string) =>
    handle<JobCreateResponse>(
      fetch(`${API}/datasets/${datasetId}/profile/refresh`, { method: 'POST' }),
    ),

  getQuality: (datasetId: string) =>
    handle<import('@/api/types').QualityIssue[]>(
      fetch(`${API}/datasets/${datasetId}/quality-issues`),
    ),

  getSample: (datasetId: string, page: number, pageSize: number) =>
    handle<SampleResponse>(
      fetch(`${API}/datasets/${datasetId}/sample?page=${page}&page_size=${pageSize}`),
    ),

  runQuery: (body: QueryRequest) =>
    handle<QueryResult>(
      fetch(`${API}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  askAgent: (body: AgentAskRequest) =>
    handle<AgentAskResponse>(
      fetch(`${API}/agent/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  getProfileHistory: (datasetId: string, limit = 10) =>
    handle<ProfileHistoryEntry[]>(
      fetch(`${API}/datasets/${datasetId}/profile/history?limit=${limit}`),
    ),

  getProfileDiff: (datasetId: string, a?: string | null, b?: string | null) => {
    const q = a && b ? `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : ''
    return handle<ProfileDiffResponse>(fetch(`${API}/datasets/${datasetId}/profile/diff${q}`))
  },

  listSavedQueries: () => handle<SavedQuery[]>(fetch(`${API}/saved-queries`)),

  createSavedQuery: (body: SavedQueryCreate) =>
    handle<SavedQuery>(
      fetch(`${API}/saved-queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  patchSavedQuery: (savedId: string, body: SavedQueryPatch) =>
    handle<SavedQuery>(
      fetch(`${API}/saved-queries/${encodeURIComponent(savedId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  deleteSavedQuery: async (savedId: string) => {
    const r = await fetch(`${API}/saved-queries/${encodeURIComponent(savedId)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(await readApiError(r))
  },

  listAskConversations: () => handle<AskConversation[]>(fetch(`${API}/ask/conversations`)),

  createAskConversation: (body: AskConversationCreate) =>
    handle<AskConversation>(
      fetch(`${API}/ask/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  patchAskConversation: (conversationId: string, body: AskConversationPatch) =>
    handle<AskConversation>(
      fetch(`${API}/ask/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  deleteAskConversation: async (conversationId: string) => {
    const r = await fetch(`${API}/ask/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    })
    if (!r.ok) throw new Error(await readApiError(r))
  },

  listAskTurns: (conversationId: string, limit = 100) =>
    handle<AskTurn[]>(
      fetch(
        `${API}/ask/conversations/${encodeURIComponent(conversationId)}/turns?limit=${encodeURIComponent(String(limit))}`,
      ),
    ),

  deleteAskTurn: async (conversationId: string, turnId: string) => {
    const r = await fetch(
      `${API}/ask/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}`,
      { method: 'DELETE' },
    )
    if (!r.ok) throw new Error(await readApiError(r))
  },

  listJobs: (limit = 100, status?: string) => {
    const q = new URLSearchParams()
    q.set('limit', String(limit))
    if (status) q.set('status', status)
    return handle<JobSummary[]>(fetch(`${API}/jobs?${q.toString()}`))
  },

  getJob: (jobId: string) => handle<JobDetail>(fetch(`${API}/jobs/${encodeURIComponent(jobId)}`)),

  cancelJob: (jobId: string) =>
    handle<JobCreateResponse>(fetch(`${API}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })),
}

export async function askAgentStream(
  body: AgentAskRequest,
  onEvent: (ev: AgentStreamEvent) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`${API}/agent/ask/stream`, {
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

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
  HealthResponse,
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
const LOCAL_TOKEN_HEADER = 'X-DCC-Local-Token'

let localSessionToken: string | null = null
let localSessionPromise: Promise<string> | null = null

async function getLocalSessionToken(): Promise<string> {
  if (localSessionToken) return localSessionToken
  if (!localSessionPromise) {
    localSessionPromise = fetch(`${API}/local-session`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await readApiError(r))
        return r.json() as Promise<{ token?: string }>
      })
      .then((session) => {
        const token = session.token || ''
        localSessionToken = token
        return token
      })
      .finally(() => {
        localSessionPromise = null
      })
  }
  return localSessionPromise
}

function withTokenHeader(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers)
  if (token) headers.set(LOCAL_TOKEN_HEADER, token)
  return { ...init, headers }
}

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getLocalSessionToken()
  const res = await fetch(input, withTokenHeader(init, token))
  if (res.status !== 403 || !token) return res
  localSessionToken = null
  const refreshed = await getLocalSessionToken()
  if (!refreshed || refreshed === token) return res
  return fetch(input, withTokenHeader(init, refreshed))
}

export function resetLocalSessionTokenForTests(): void {
  localSessionToken = null
  localSessionPromise = null
}

export function setLocalSessionTokenForTests(token: string): void {
  localSessionToken = token
  localSessionPromise = null
}

export class ApiRequestError extends Error {
  readonly code: string
  readonly details: Record<string, unknown> | null | undefined

  constructor(message: string, code: string, details?: Record<string, unknown> | null) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.details = details
  }
}

function parseApiErrorText(text: string): ApiError | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { error?: ApiError; detail?: string }
    if (parsed?.error?.code && parsed?.error?.message) {
      return parsed.error
    }
    if (typeof parsed?.detail === 'string') {
      return { code: 'BAD_REQUEST', message: parsed.detail, details: null }
    }
  } catch {
    return null
  }
  return null
}

export async function parseApiErrorFromResponse(r: Response): Promise<ApiError | null> {
  return parseApiErrorText(await r.text())
}

async function readApiError(r: Response): Promise<string> {
  const text = await r.text()
  const structured = parseApiErrorText(text)
  if (structured?.message) return structured.message
  return text || r.statusText || 'Request failed'
}

async function handle<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    throw new Error(await readApiError(r))
  }
  return r.json() as Promise<T>
}

async function waitForJob(jobId: string): Promise<JobDetail> {
  for (;;) {
    const job = await handle<JobDetail>(apiFetch(`${API}/jobs/${encodeURIComponent(jobId)}`))
    if (job.status === 'completed') return job
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new ApiRequestError(
        job.error_message ?? `Job ${job.status}`,
        job.error_code ?? 'JOB_FAILED',
        { job_id: jobId },
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
}

async function fetchDatasetProfile(datasetId: string): Promise<DatasetProfile> {
  const r = await apiFetch(`${API}/datasets/${datasetId}/profile`)
  const text = await r.text()
  if (r.ok) {
    return JSON.parse(text) as DatasetProfile
  }
  const err = parseApiErrorText(text)
  if (err?.code === 'PROFILE_NOT_READY' && err.details?.job_id) {
    await waitForJob(String(err.details.job_id))
    return fetchDatasetProfile(datasetId)
  }
  throw new ApiRequestError(
    err?.message ?? r.statusText ?? 'Request failed',
    err?.code ?? 'BAD_REQUEST',
    err?.details,
  )
}

export const api = {
  health: () => handle<HealthResponse>(fetch(`${API}/health`)),

  listDatasets: () => handle<DatasetSummary[]>(apiFetch(`${API}/datasets`)),

  uploadDatasets: (files: File[]) => {
    const body = new FormData()
    for (const f of files) body.append('files', f)
    return handle<DatasetSummary[]>(
      apiFetch(`${API}/datasets/upload`, {
        method: 'POST',
        body,
      }),
    )
  },

  getProfile: (datasetId: string) =>
    handle<DatasetProfile>(apiFetch(`${API}/datasets/${datasetId}/profile`)),

  fetchDatasetProfile,

  waitForJob,

  deleteDataset: async (datasetId: string) => {
    const r = await apiFetch(`${API}/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(await readApiError(r))
  },

  refreshProfile: (datasetId: string) =>
    handle<JobCreateResponse>(
      apiFetch(`${API}/datasets/${datasetId}/profile/refresh`, { method: 'POST' }),
    ),

  getQuality: (datasetId: string) =>
    handle<import('@/api/types').QualityIssue[]>(
      apiFetch(`${API}/datasets/${datasetId}/quality-issues`),
    ),

  getSample: (datasetId: string, page: number, pageSize: number) =>
    handle<SampleResponse>(
      apiFetch(`${API}/datasets/${datasetId}/sample?page=${page}&page_size=${pageSize}`),
    ),

  runQuery: (body: QueryRequest) =>
    handle<QueryResult>(
      apiFetch(`${API}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  askAgent: (body: AgentAskRequest) =>
    handle<AgentAskResponse>(
      apiFetch(`${API}/agent/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  getProfileHistory: (datasetId: string, limit = 10) =>
    handle<ProfileHistoryEntry[]>(
      apiFetch(`${API}/datasets/${datasetId}/profile/history?limit=${limit}`),
    ),

  getProfileDiff: (datasetId: string, a?: string | null, b?: string | null) => {
    const q = a && b ? `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : ''
    return handle<ProfileDiffResponse>(apiFetch(`${API}/datasets/${datasetId}/profile/diff${q}`))
  },

  listSavedQueries: () => handle<SavedQuery[]>(apiFetch(`${API}/saved-queries`)),

  createSavedQuery: (body: SavedQueryCreate) =>
    handle<SavedQuery>(
      apiFetch(`${API}/saved-queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  patchSavedQuery: (savedId: string, body: SavedQueryPatch) =>
    handle<SavedQuery>(
      apiFetch(`${API}/saved-queries/${encodeURIComponent(savedId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  deleteSavedQuery: async (savedId: string) => {
    const r = await apiFetch(`${API}/saved-queries/${encodeURIComponent(savedId)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(await readApiError(r))
  },

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

  listJobs: (limit = 100, status?: string) => {
    const q = new URLSearchParams()
    q.set('limit', String(limit))
    if (status) q.set('status', status)
    return handle<JobSummary[]>(apiFetch(`${API}/jobs?${q.toString()}`))
  },

  getJob: (jobId: string) => handle<JobDetail>(apiFetch(`${API}/jobs/${encodeURIComponent(jobId)}`)),

  cancelJob: (jobId: string) =>
    handle<JobCreateResponse>(apiFetch(`${API}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })),
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

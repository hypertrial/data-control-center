import type {
  AgentAskRequest,
  AgentStreamEvent,
  ApiError,
  AskConversation,
  AskConversationCreate,
  AskConversationPatch,
  AskTurn,
  DatasetProfile,
  DatasetSummary,
  DuckDbRelationRef,
  DuckDbRelationSummary,
  DuckDbCapabilities,
  DuckDbSourceResponse,
  HealthResponse,
  JobCreateResponse,
  JobDetail,
  JobSummary,
  LlmModelsResponse,
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
const DEFAULT_FETCH_CREDENTIALS: RequestCredentials = 'include'

let localSessionToken: string | null = null
let localSessionPromise: Promise<string> | null = null

function mergeFetchInit(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    credentials: init.credentials ?? DEFAULT_FETCH_CREDENTIALS,
  }
}

export function clearLocalSessionCache(): void {
  localSessionToken = null
  localSessionPromise = null
}

async function getLocalSessionToken(): Promise<string> {
  if (localSessionToken) return localSessionToken
  if (!localSessionPromise) {
    localSessionPromise = fetch(`${API}/local-session`, mergeFetchInit())
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

/** Bootstrap check: fetch local session before protected API calls. */
export async function validateLocalSession(): Promise<void> {
  try {
    await getLocalSessionToken()
  } catch (err) {
    clearLocalSessionCache()
    throw err
  }
}

function withTokenHeader(init: RequestInit, token: string): RequestInit {
  const merged = mergeFetchInit(init)
  const headers = new Headers(merged.headers)
  if (token) headers.set(LOCAL_TOKEN_HEADER, token)
  return { ...merged, headers }
}

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getLocalSessionToken()
  const res = await fetch(input, withTokenHeader(init, token))
  if (res.status !== 403 || !token) return res
  clearLocalSessionCache()
  const refreshed = await getLocalSessionToken()
  if (!refreshed || refreshed === token) return res
  return fetch(input, withTokenHeader(init, refreshed))
}

export function resetLocalSessionTokenForTests(): void {
  clearLocalSessionCache()
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

const DEFAULT_JOB_POLL_INTERVAL_MS = 1200
const DEFAULT_JOB_POLL_MAX_INTERVAL_MS = 8000
const DEFAULT_JOB_POLL_TIMEOUT_MS = 600_000

export function nextJobPollIntervalMs(attempt: number): number {
  const ms = DEFAULT_JOB_POLL_INTERVAL_MS * 2 ** Math.max(0, attempt)
  return Math.min(ms, DEFAULT_JOB_POLL_MAX_INTERVAL_MS)
}

export type JobPollOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  pollIntervalMs?: number
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (!signal) return
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function waitForJob(jobId: string, opts?: JobPollOptions): Promise<JobDetail> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_JOB_POLL_TIMEOUT_MS
  const started = Date.now()
  let attempt = 0
  for (;;) {
    throwIfAborted(opts?.signal)
    if (Date.now() - started > timeoutMs) {
      throw new ApiRequestError(
        `Job polling timed out after ${timeoutMs}ms`,
        'JOB_POLL_TIMEOUT',
        { job_id: jobId },
      )
    }
    const job = await handle<JobDetail>(apiFetch(`${API}/jobs/${encodeURIComponent(jobId)}`))
    if (job.status === 'completed') return job
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new ApiRequestError(
        job.error_message ?? `Job ${job.status}`,
        job.error_code ?? 'JOB_FAILED',
        { job_id: jobId },
      )
    }
    const pollIntervalMs = opts?.pollIntervalMs ?? nextJobPollIntervalMs(attempt)
    await sleep(pollIntervalMs, opts?.signal)
    attempt += 1
  }
}

export async function fetchDatasetProfileOnce(
  datasetId: string,
  opts?: { signal?: AbortSignal },
): Promise<DatasetProfile> {
  throwIfAborted(opts?.signal)
  const r = await apiFetch(`${API}/datasets/${datasetId}/profile`)
  const text = await r.text()
  if (r.ok) {
    return JSON.parse(text) as DatasetProfile
  }
  const err = parseApiErrorText(text)
  throw new ApiRequestError(
    err?.message ?? r.statusText ?? 'Request failed',
    err?.code ?? 'BAD_REQUEST',
    err?.details ?? undefined,
  )
}

async function fetchDatasetProfile(datasetId: string, opts?: JobPollOptions): Promise<DatasetProfile> {
  try {
    return await fetchDatasetProfileOnce(datasetId, { signal: opts?.signal })
  } catch (err) {
    if (
      err instanceof ApiRequestError &&
      err.code === 'PROFILE_NOT_READY' &&
      err.details?.job_id
    ) {
      await waitForJob(String(err.details.job_id), opts)
      return fetchDatasetProfileOnce(datasetId, { signal: opts?.signal })
    }
    throw err
  }
}

export const api = {
  health: () => handle<HealthResponse>(fetch(`${API}/health`, mergeFetchInit())),

  listLlmModels: () => handle<LlmModelsResponse>(apiFetch(`${API}/llm/models`)),

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

  duckDbCapabilities: () =>
    handle<DuckDbCapabilities>(apiFetch(`${API}/datasets/duckdb/capabilities`)),

  uploadDuckDb: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return handle<DuckDbSourceResponse>(
      apiFetch(`${API}/datasets/duckdb/upload`, {
        method: 'POST',
        body,
      }),
    )
  },

  openLocalDuckDb: (path: string) =>
    handle<DuckDbSourceResponse>(
      apiFetch(`${API}/datasets/duckdb/open-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    ),

  pickLocalDuckDb: () =>
    handle<DuckDbSourceResponse>(
      apiFetch(`${API}/datasets/duckdb/pick-local`, {
        method: 'POST',
      }),
    ),

  inspectDuckDb: (sourceId: string, options?: { includeRowCounts?: boolean }) =>
    handle<DuckDbRelationSummary[]>(
      apiFetch(`${API}/datasets/duckdb/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: sourceId,
          include_row_counts: options?.includeRowCounts ?? false,
        }),
      }),
    ),

  duckDbRelationCount: (sourceId: string, schema: string, name: string) =>
    handle<{ row_count: number | null }>(
      apiFetch(`${API}/datasets/duckdb/relation-count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: sourceId, schema, name }),
      }),
    ),

  importDuckDbRelations: (sourceId: string, relations: DuckDbRelationRef[]) =>
    handle<JobCreateResponse>(
      apiFetch(`${API}/datasets/duckdb/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: sourceId, relations }),
      }),
    ),

  waitForJob,
  fetchDatasetProfile,
  fetchDatasetProfileOnce,

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

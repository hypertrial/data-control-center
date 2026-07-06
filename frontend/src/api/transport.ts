import type { ApiError } from '@/api/types'

export const API = '/api'
const LOCAL_TOKEN_HEADER = 'X-DCC-Local-Token'
const DEFAULT_FETCH_CREDENTIALS: RequestCredentials = 'include'

let localSessionToken: string | null = null
let localSessionPromise: Promise<string> | null = null

export function mergeFetchInit(init: RequestInit = {}): RequestInit {
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

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
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

export function parseApiErrorText(text: string): ApiError | null {
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

export async function readApiError(r: Response): Promise<string> {
  const text = await r.text()
  const structured = parseApiErrorText(text)
  if (structured?.message) return structured.message
  return text || r.statusText || 'Request failed'
}

export async function handle<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    throw new Error(await readApiError(r))
  }
  return r.json() as Promise<T>
}

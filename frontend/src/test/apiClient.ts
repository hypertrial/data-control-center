import { afterEach, beforeEach, expect, vi } from 'vitest'
import { resetLocalSessionTokenForTests, setLocalSessionTokenForTests } from '@/api/client'

export const LOCAL_TOKEN_HEADER = 'X-DCC-Local-Token'

export function jsonOk(data: unknown): Response {
  return {
    ok: true,
    statusText: 'OK',
    text: () => Promise.resolve(''),
    json: () => Promise.resolve(data),
  } as Response
}

export function textErr(message: string, statusText = 'Bad'): Response {
  return {
    ok: false,
    statusText,
    text: () => Promise.resolve(message),
    json: () => Promise.reject(new Error('no json')),
  } as Response
}

export function apiError(message: string, status = 403): Response {
  return {
    ok: false,
    status,
    statusText: 'Forbidden',
    text: () => Promise.resolve(JSON.stringify({ error: { message } })),
    json: () => Promise.reject(new Error('no json')),
  } as Response
}

export function expectToken(init: RequestInit | undefined): void {
  expect(new Headers(init?.headers).get(LOCAL_TOKEN_HEADER)).toBe('test-token')
}

export function installApiClientTestSession(): void {
  beforeEach(() => {
    setLocalSessionTokenForTests('test-token')
  })

  afterEach(() => {
    resetLocalSessionTokenForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}

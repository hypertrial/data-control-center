import { describe, expect, it, vi } from 'vitest'
import {
  api,
  parseApiErrorFromResponse,
  resetLocalSessionTokenForTests,
} from '@/api/client'
import { apiError, installApiClientTestSession, jsonOk, textErr } from '@/test/apiClient'

installApiClientTestSession()

describe('api transport', () => {
  it('throws on non-ok with message from body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textErr('nope')))
    await expect(api.listDatasets()).rejects.toThrow('nope')
  })

  it('throws on non-ok empty body using statusText', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Server Error',
        text: () => Promise.resolve(''),
      } as Response),
    )
    await expect(api.health()).rejects.toThrow('Server Error')
  })

  it('fetches local session once and reuses the token', async () => {
    resetLocalSessionTokenForTests()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ token: 'boot-token', local_only: true }))
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk([]))
    vi.stubGlobal('fetch', fetchMock)
    await api.listDatasets()
    await api.listDatasets()
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/local-session',
      '/api/datasets',
      '/api/datasets',
    ])
    expect(new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers).get('X-DCC-Local-Token')).toBe(
      'boot-token',
    )
    expect(new Headers((fetchMock.mock.calls[2]![1] as RequestInit).headers).get('X-DCC-Local-Token')).toBe(
      'boot-token',
    )
  })

  it('refreshes local session once after a protected call rejects the cached token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiError('Missing or invalid local API token.'))
      .mockResolvedValueOnce(jsonOk({ token: 'new-token', local_only: true }))
      .mockResolvedValueOnce(jsonOk([]))
    vi.stubGlobal('fetch', fetchMock)
    await api.listDatasets()
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/datasets',
      '/api/local-session',
      '/api/datasets',
    ])
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get('X-DCC-Local-Token')).toBe(
      'test-token',
    )
    expect(new Headers((fetchMock.mock.calls[2]![1] as RequestInit).headers).get('X-DCC-Local-Token')).toBe(
      'new-token',
    )
  })

  it('does not retry a protected 403 when local-session returns the same token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiError('Path registration is disabled.'))
      .mockResolvedValueOnce(jsonOk({ token: 'test-token', local_only: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.listDatasets()).rejects.toThrow('Path registration is disabled.')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/datasets', '/api/local-session'])
  })

  it('parseApiErrorFromResponse reads structured and detail payloads', async () => {
    const structured = await parseApiErrorFromResponse({
      text: () =>
        Promise.resolve(
          JSON.stringify({ error: { code: 'X', message: 'msg', details: { job_id: 'j1' } } }),
        ),
    } as Response)
    expect(structured).toEqual({ code: 'X', message: 'msg', details: { job_id: 'j1' } })

    const detail = await parseApiErrorFromResponse({
      text: () => Promise.resolve(JSON.stringify({ detail: 'plain detail' })),
    } as Response)
    expect(detail).toEqual({ code: 'BAD_REQUEST', message: 'plain detail', details: null })
  })
})

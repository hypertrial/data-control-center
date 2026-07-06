import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { expectToken, installApiClientTestSession, jsonOk } from '@/test/apiClient'

installApiClientTestSession()

describe('query api client', () => {
  it('runQuery POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ columns: [], rows: [], row_count: 0, error: null }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await api.runQuery({ sql: 'SELECT 1', max_rows: 5 })
    expect(fetchMock).toHaveBeenCalledWith('/api/query', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sql: 'SELECT 1', max_rows: 5 }),
    }))
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expectToken(init)
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('saved queries CRUD', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk({
        saved_id: 'sq_1',
        name: 'q',
        sql: 'SELECT 1',
        description: 'note',
        created_at: 'c',
        updated_at: 'u',
      }))
      .mockResolvedValueOnce(jsonOk({
        saved_id: 'sq_1',
        name: 'q2',
        sql: 'SELECT 2',
        description: null,
        created_at: 'c',
        updated_at: 'u2',
      }))
      .mockResolvedValueOnce({ ok: true, statusText: 'No Content', text: () => Promise.resolve('') } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await api.listSavedQueries()
    await api.createSavedQuery({ name: 'q', sql: 'SELECT 1', description: 'note' })
    await api.patchSavedQuery('sq_1', { name: 'q2', description: null })
    await api.deleteSavedQuery('sq_1')
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries/sq_1', expect.objectContaining({ method: 'PATCH' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-queries/sq_1', expect.objectContaining({ method: 'DELETE' }))
  })
})

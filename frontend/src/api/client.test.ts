import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'

function jsonOk(data: unknown): Response {
  return {
    ok: true,
    statusText: 'OK',
    text: () => Promise.resolve(''),
    json: () => Promise.resolve(data),
  } as Response
}

function textErr(message: string, statusText = 'Bad'): Response {
  return {
    ok: false,
    statusText,
    text: () => Promise.resolve(message),
    json: () => Promise.reject(new Error('no json')),
  } as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('api client', () => {
  it('health calls /api/health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ status: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.health()).resolves.toEqual({ status: 'ok' })
    expect(fetchMock).toHaveBeenCalledWith('/api/health')
  })

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

  it('listDatasets GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([]))
    vi.stubGlobal('fetch', fetchMock)
    await api.listDatasets()
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets')
  })

  it('registerFile POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({
        dataset_id: 'ds_001',
        name: 'a.csv',
        source_path: '/x',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 1,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await api.registerFile('/path')
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/register-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/path' }),
    })
  })

  it('registerFolder POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([]))
    vi.stubGlobal('fetch', fetchMock)
    await api.registerFolder('/f', true)
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/register-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/f', recursive: true }),
    })
  })

  it('uploadDatasets POST FormData', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([]))
    vi.stubGlobal('fetch', fetchMock)
    const f = new File(['id\n1'], 't.csv', { type: 'text/csv' })
    await api.uploadDatasets([f])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/datasets/upload',
      expect.objectContaining({ method: 'POST' }),
    )
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('getProfile GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ dataset_id: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    await api.getProfile('ds_1')
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/profile')
  })

  it('refreshProfile POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ dataset_id: 'ds_1' }))
    vi.stubGlobal('fetch', fetchMock)
    await api.refreshProfile('ds_1')
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/profile/refresh', {
      method: 'POST',
    })
  })

  it('getQuality GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([]))
    vi.stubGlobal('fetch', fetchMock)
    await api.getQuality('ds_1')
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/quality-issues')
  })

  it('getSample GET with query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ page: 1, page_size: 10, row_count: 0, columns: [], rows: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await api.getSample('ds_1', 2, 20)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/datasets/ds_1/sample?page=2&page_size=20',
    )
  })

  it('runQuery POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ columns: [], rows: [], row_count: 0, error: null }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await api.runQuery({ sql: 'SELECT 1', max_rows: 5 })
    expect(fetchMock).toHaveBeenCalledWith('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1', max_rows: 5 }),
    })
  })
})

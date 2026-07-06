import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { expectToken, installApiClientTestSession, jsonOk } from '@/test/apiClient'

installApiClientTestSession()

describe('dataset api client', () => {
  it('listDatasets GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([]))
    vi.stubGlobal('fetch', fetchMock)
    await api.listDatasets()
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets', expect.any(Object))
    expectToken(fetchMock.mock.calls[0]![1] as RequestInit)
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
    expectToken(init)
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('uploadDuckDb POST multipart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOk({ source_id: 'up1', filename: 'source.duckdb', source_kind: 'upload' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['db'], 'source.duckdb')
    await api.uploadDuckDb(file)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/datasets/duckdb/upload',
      expect.objectContaining({ method: 'POST' }),
    )
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expectToken(init)
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('DuckDB source and relation endpoints use expected JSON payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({
        local_open_enabled: true,
        upload_soft_max_bytes: 512,
        inspect_include_row_counts_default: false,
        native_pick_enabled: true,
        view_import_enabled: true,
      }))
      .mockResolvedValueOnce(jsonOk({ source_id: 'loc_1', filename: 'w.duckdb', source_kind: 'local' }))
      .mockResolvedValueOnce(jsonOk({ source_id: 'loc_1', filename: 'w.duckdb', source_kind: 'local' }))
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk({ row_count: 42 }))
      .mockResolvedValueOnce(jsonOk({ job_id: 'j1', status: 'queued' }))
    vi.stubGlobal('fetch', fetchMock)

    await api.duckDbCapabilities()
    await api.pickLocalDuckDb()
    await api.openLocalDuckDb('/data/w.duckdb')
    await api.inspectDuckDb('up1')
    await api.inspectDuckDb('up1', { includeRowCounts: true })
    await expect(api.duckDbRelationCount('up1', 'main', 'orders')).resolves.toEqual({ row_count: 42 })
    await api.importDuckDbRelations('up1', [{ schema: 'main', name: 'orders', alias: 'orders_copy' }])

    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/duckdb/capabilities', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/duckdb/pick-local', expect.objectContaining({ method: 'POST' }))
    expect((fetchMock.mock.calls[2]![1] as RequestInit).body).toBe(JSON.stringify({ path: '/data/w.duckdb' }))
    expect((fetchMock.mock.calls[3]![1] as RequestInit).body).toBe(
      JSON.stringify({ source_id: 'up1', include_row_counts: false }),
    )
    expect((fetchMock.mock.calls[4]![1] as RequestInit).body).toBe(
      JSON.stringify({ source_id: 'up1', include_row_counts: true }),
    )
    expect((fetchMock.mock.calls[5]![1] as RequestInit).body).toBe(
      JSON.stringify({ source_id: 'up1', schema: 'main', name: 'orders' }),
    )
    expect((fetchMock.mock.calls[6]![1] as RequestInit).body).toBe(
      JSON.stringify({
        source_id: 'up1',
        relations: [{ schema: 'main', name: 'orders', alias: 'orders_copy' }],
      }),
    )
  })

  it('dataset detail endpoints use expected methods and query strings', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, statusText: 'No Content', text: () => Promise.resolve('') } as Response)
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk({ page: 1, page_size: 10, row_count: 0, columns: [], rows: [] }))
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk({
        history_id_a: 'a',
        history_id_b: 'b',
        created_at_a: 't1',
        created_at_b: 't2',
        new_columns: [],
        removed_columns: [],
        null_pct_changes: [],
        quality_score_delta: null,
      }))
    vi.stubGlobal('fetch', fetchMock)

    await api.deleteDataset('ds_1')
    await api.getQuality('ds_1')
    await api.getSample('ds_1', 2, 20)
    await api.getProfileHistory('ds_1', 5)
    await api.getProfileDiff('ds_1', 'a', 'b')

    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1', expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/quality-issues', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/sample?page=2&page_size=20', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/profile/history?limit=5', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/ds_1/profile/diff?a=a&b=b', expect.any(Object))
  })
})

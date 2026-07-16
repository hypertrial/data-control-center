import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { installApiClientTestSession, jsonOk } from '@/test/apiClient'

installApiClientTestSession()

describe('workspace feature api client', () => {
  it('uses saved chart CRUD endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk({ chart_id: 'c1' }))
      .mockResolvedValueOnce(jsonOk({ chart_id: 'c1' }))
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const body = { dataset_id: 'ds 1', name: 'Chart', spec: { version: 4, datasetId: 'ds 1' } }

    await api.listSavedCharts('ds 1')
    await api.createSavedChart(body)
    await api.patchSavedChart('c1', { name: 'Updated' })
    await api.deleteSavedChart('c1')

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/saved-charts?dataset_id=ds%201')
    expect(fetchMock.mock.calls[1]![1]).toEqual(expect.objectContaining({ method: 'POST' }))
    expect(fetchMock.mock.calls[2]![1]).toEqual(expect.objectContaining({ method: 'PATCH' }))
    expect(fetchMock.mock.calls[3]![1]).toEqual(expect.objectContaining({ method: 'DELETE' }))
  })

  it('uses relationship, decision, verification, and dependency endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk({ relationships: [], pending_dataset_ids: [] }))
      .mockResolvedValueOnce(jsonOk({ relationship_id: 'r1' }))
      .mockResolvedValueOnce(jsonOk({ relationship_id: 'r1' }))
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as Response)
      .mockResolvedValueOnce(jsonOk({ saved_chart_count: 1, relationship_decision_count: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.listRelationships('ds_1', true)
    await api.verifyRelationship('r1')
    await api.setRelationshipDecision('r1', 'confirmed')
    await api.deleteRelationshipDecision('r1')
    await api.getDatasetDependencies('ds_1')

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/relationships?dataset_id=ds_1&include_dismissed=true',
      '/api/relationships/r1/verify',
      '/api/relationships/r1/decision',
      '/api/relationships/r1/decision',
      '/api/datasets/ds_1/dependencies',
    ])
  })
})

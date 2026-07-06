import { API, apiFetch, handle, readApiError } from '@/api/transport'
import type {
  DatasetSummary,
  DuckDbCapabilities,
  DuckDbRelationRef,
  DuckDbRelationSummary,
  DuckDbSourceResponse,
  JobCreateResponse,
  ProfileDiffResponse,
  ProfileHistoryEntry,
  QualityIssue,
  SampleResponse,
} from '@/api/types'

export const datasetApi = {
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

  deleteDataset: async (datasetId: string) => {
    const r = await apiFetch(`${API}/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(await readApiError(r))
  },

  getQuality: (datasetId: string) =>
    handle<QualityIssue[]>(
      apiFetch(`${API}/datasets/${datasetId}/quality-issues`),
    ),

  getSample: (datasetId: string, page: number, pageSize: number) =>
    handle<SampleResponse>(
      apiFetch(`${API}/datasets/${datasetId}/sample?page=${page}&page_size=${pageSize}`),
    ),

  getProfileHistory: (datasetId: string, limit = 10) =>
    handle<ProfileHistoryEntry[]>(
      apiFetch(`${API}/datasets/${datasetId}/profile/history?limit=${limit}`),
    ),

  getProfileDiff: (datasetId: string, a?: string | null, b?: string | null) => {
    const q = a && b ? `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : ''
    return handle<ProfileDiffResponse>(apiFetch(`${API}/datasets/${datasetId}/profile/diff${q}`))
  },
}

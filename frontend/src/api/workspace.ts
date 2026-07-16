import { API, apiFetch, handle, readApiError } from '@/api/transport'
import type {
  DatasetDependencies,
  DatasetRelationship,
  RelationshipVerification,
  RelationshipsResponse,
  SavedChart,
  SavedChartCreate,
  SavedChartPatch,
} from '@/api/types'

async function deleteRequest(path: string): Promise<void> {
  const response = await apiFetch(`${API}${path}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await readApiError(response))
}

export const workspaceApi = {
  listSavedCharts: (datasetId?: string | null) =>
    handle<SavedChart[]>(
      apiFetch(
        `${API}/saved-charts${datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : ''}`,
      ),
    ),

  createSavedChart: (body: SavedChartCreate) =>
    handle<SavedChart>(
      apiFetch(`${API}/saved-charts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  patchSavedChart: (chartId: string, body: SavedChartPatch) =>
    handle<SavedChart>(
      apiFetch(`${API}/saved-charts/${encodeURIComponent(chartId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  deleteSavedChart: (chartId: string) =>
    deleteRequest(`/saved-charts/${encodeURIComponent(chartId)}`),

  listRelationships: (datasetId?: string | null, includeDismissed = false) => {
    const params = new URLSearchParams()
    if (datasetId) params.set('dataset_id', datasetId)
    if (includeDismissed) params.set('include_dismissed', 'true')
    const query = params.toString()
    return handle<RelationshipsResponse>(
      apiFetch(`${API}/relationships${query ? `?${query}` : ''}`),
    )
  },

  verifyRelationship: (relationshipId: string) =>
    handle<RelationshipVerification>(
      apiFetch(`${API}/relationships/${encodeURIComponent(relationshipId)}/verify`, {
        method: 'POST',
      }),
    ),

  setRelationshipDecision: (
    relationshipId: string,
    status: 'confirmed' | 'dismissed',
  ) =>
    handle<DatasetRelationship>(
      apiFetch(`${API}/relationships/${encodeURIComponent(relationshipId)}/decision`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    ),

  deleteRelationshipDecision: (relationshipId: string) =>
    deleteRequest(`/relationships/${encodeURIComponent(relationshipId)}/decision`),

  getDatasetDependencies: (datasetId: string) =>
    handle<DatasetDependencies>(
      apiFetch(`${API}/datasets/${encodeURIComponent(datasetId)}/dependencies`),
    ),
}

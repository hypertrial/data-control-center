import { API, apiFetch, handle, readApiError } from '@/api/transport'
import type { QueryRequest, QueryResult, SavedQuery, SavedQueryCreate, SavedQueryPatch } from '@/api/types'

export const queryApi = {
  runQuery: (body: QueryRequest) =>
    handle<QueryResult>(
      apiFetch(`${API}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

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
}

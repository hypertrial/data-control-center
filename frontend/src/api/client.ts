import type {
  DatasetProfile,
  DatasetSummary,
  QueryRequest,
  QueryResult,
  RelationshipCandidate,
  SampleResponse,
} from '@/api/types'

const API = '/api'

async function handle<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const text = await r.text()
    throw new Error(text || r.statusText)
  }
  return r.json() as Promise<T>
}

export const api = {
  health: () => handle<{ status: string }>(fetch(`${API}/health`)),

  listDatasets: () => handle<DatasetSummary[]>(fetch(`${API}/datasets`)),

  registerFile: (path: string) =>
    handle<DatasetSummary>(
      fetch(`${API}/datasets/register-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    ),

  registerFolder: (path: string, recursive: boolean) =>
    handle<DatasetSummary[]>(
      fetch(`${API}/datasets/register-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, recursive }),
      }),
    ),

  getProfile: (datasetId: string) =>
    handle<DatasetProfile>(fetch(`${API}/datasets/${datasetId}/profile`)),

  getQuality: (datasetId: string) =>
    handle<import('@/api/types').QualityIssue[]>(
      fetch(`${API}/datasets/${datasetId}/quality-issues`),
    ),

  getSample: (datasetId: string, page: number, pageSize: number) =>
    handle<SampleResponse>(
      fetch(
        `${API}/datasets/${datasetId}/sample?page=${page}&page_size=${pageSize}`,
      ),
    ),

  runQuery: (body: QueryRequest) =>
    handle<QueryResult>(
      fetch(`${API}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),

  relationships: () =>
    handle<RelationshipCandidate[]>(fetch(`${API}/relationships`)),
}

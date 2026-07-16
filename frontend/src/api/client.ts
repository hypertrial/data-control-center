import type { HealthResponse, LlmModelsResponse } from '@/api/types'
import { askAgentStream, askApi } from '@/api/ask'
import { datasetApi } from '@/api/datasets'
import { jobApi, nextJobPollIntervalMs, waitForJob, fetchDatasetProfileOnce } from '@/api/jobs'
import { queryApi } from '@/api/queries'
import { API, apiFetch, handle, mergeFetchInit } from '@/api/transport'
import { workspaceApi } from '@/api/workspace'

export {
  ApiRequestError,
  clearLocalSessionCache,
  parseApiErrorFromResponse,
  resetLocalSessionTokenForTests,
  setLocalSessionTokenForTests,
  validateLocalSession,
} from '@/api/transport'
export { askAgentStream, fetchDatasetProfileOnce, nextJobPollIntervalMs, waitForJob }
export type { JobPollOptions } from '@/api/jobs'

export const api = {
  health: () => handle<HealthResponse>(fetch(`${API}/health`, mergeFetchInit())),

  listLlmModels: () => handle<LlmModelsResponse>(apiFetch(`${API}/llm/models`)),

  ...datasetApi,
  ...jobApi,
  ...queryApi,
  ...askApi,
  ...workspaceApi,
}

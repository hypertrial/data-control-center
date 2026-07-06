import { API, ApiRequestError, apiFetch, handle, parseApiErrorText } from '@/api/transport'
import type { DatasetProfile, JobCreateResponse, JobDetail, JobSummary } from '@/api/types'

const DEFAULT_JOB_POLL_INTERVAL_MS = 1200
const DEFAULT_JOB_POLL_MAX_INTERVAL_MS = 8000
const DEFAULT_JOB_POLL_TIMEOUT_MS = 600_000

export function nextJobPollIntervalMs(attempt: number): number {
  const ms = DEFAULT_JOB_POLL_INTERVAL_MS * 2 ** Math.max(0, attempt)
  return Math.min(ms, DEFAULT_JOB_POLL_MAX_INTERVAL_MS)
}

export type JobPollOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  pollIntervalMs?: number
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (!signal) return
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function waitForJob(jobId: string, opts?: JobPollOptions): Promise<JobDetail> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_JOB_POLL_TIMEOUT_MS
  const started = Date.now()
  let attempt = 0
  for (;;) {
    throwIfAborted(opts?.signal)
    if (Date.now() - started > timeoutMs) {
      throw new ApiRequestError(
        `Job polling timed out after ${timeoutMs}ms`,
        'JOB_POLL_TIMEOUT',
        { job_id: jobId },
      )
    }
    const job = await handle<JobDetail>(apiFetch(`${API}/jobs/${encodeURIComponent(jobId)}`))
    if (job.status === 'completed') return job
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new ApiRequestError(
        job.error_message ?? `Job ${job.status}`,
        job.error_code ?? 'JOB_FAILED',
        { job_id: jobId },
      )
    }
    const pollIntervalMs = opts?.pollIntervalMs ?? nextJobPollIntervalMs(attempt)
    await sleep(pollIntervalMs, opts?.signal)
    attempt += 1
  }
}

export async function fetchDatasetProfileOnce(
  datasetId: string,
  opts?: { signal?: AbortSignal },
): Promise<DatasetProfile> {
  throwIfAborted(opts?.signal)
  const r = await apiFetch(`${API}/datasets/${datasetId}/profile`)
  const text = await r.text()
  if (r.ok) {
    return JSON.parse(text) as DatasetProfile
  }
  const err = parseApiErrorText(text)
  throw new ApiRequestError(
    err?.message ?? r.statusText ?? 'Request failed',
    err?.code ?? 'BAD_REQUEST',
    err?.details ?? undefined,
  )
}

async function fetchDatasetProfile(datasetId: string, opts?: JobPollOptions): Promise<DatasetProfile> {
  try {
    return await fetchDatasetProfileOnce(datasetId, { signal: opts?.signal })
  } catch (err) {
    if (
      err instanceof ApiRequestError &&
      err.code === 'PROFILE_NOT_READY' &&
      err.details?.job_id
    ) {
      await waitForJob(String(err.details.job_id), opts)
      return fetchDatasetProfileOnce(datasetId, { signal: opts?.signal })
    }
    throw err
  }
}

export const jobApi = {
  waitForJob,
  fetchDatasetProfile,
  fetchDatasetProfileOnce,

  refreshProfile: (datasetId: string) =>
    handle<JobCreateResponse>(
      apiFetch(`${API}/datasets/${datasetId}/profile/refresh`, { method: 'POST' }),
    ),

  listJobs: (limit = 100, status?: string) => {
    const q = new URLSearchParams()
    q.set('limit', String(limit))
    if (status) q.set('status', status)
    return handle<JobSummary[]>(apiFetch(`${API}/jobs?${q.toString()}`))
  },

  getJob: (jobId: string) => handle<JobDetail>(apiFetch(`${API}/jobs/${encodeURIComponent(jobId)}`)),

  cancelJob: (jobId: string) =>
    handle<JobCreateResponse>(apiFetch(`${API}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })),
}

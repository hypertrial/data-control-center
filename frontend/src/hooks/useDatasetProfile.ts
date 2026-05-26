import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiRequestError, api, nextJobPollIntervalMs } from '@/api/client'
import type { DatasetProfile } from '@/api/types'
import type { JobDetail } from '@/api/types'

const PROFILE_STALE_MS = 30_000
const handledProfileCompletions = new Set<string>()

function completionKey(datasetId: string, jobId: string): string {
  return `${datasetId}\0${jobId}`
}

function markProfileCompletionHandled(datasetId: string, jobId: string): boolean {
  const key = completionKey(datasetId, jobId)
  if (handledProfileCompletions.has(key)) return false
  handledProfileCompletions.add(key)
  return true
}

function invalidateProfileAfterJob(qc: QueryClient, datasetId: string) {
  void qc.invalidateQueries({ queryKey: ['profile', datasetId] })
  void qc.invalidateQueries({ queryKey: ['quality', datasetId] })
  void qc.invalidateQueries({ queryKey: ['profile-history', datasetId] })
  void qc.invalidateQueries({ queryKey: ['datasets'] })
}

/** @internal test helper */
export function resetDatasetProfileJobStateForTests() {
  handledProfileCompletions.clear()
}

export function useDatasetProfile(datasetId: string | null | undefined) {
  const qc = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const profileQ = useQuery({
    queryKey: ['profile', datasetId],
    queryFn: ({ signal }) => api.fetchDatasetProfileOnce(datasetId!, { signal }),
    enabled: !!datasetId,
    retry: false,
    staleTime: PROFILE_STALE_MS,
  })

  useEffect(() => {
    const err = profileQ.error
    if (!datasetId) return
    if (!(err instanceof ApiRequestError && err.code === 'PROFILE_NOT_READY' && err.details?.job_id)) return

    const jobId = String(err.details.job_id)
    if (handledProfileCompletions.has(completionKey(datasetId, jobId))) return

    const cachedJob = qc.getQueryData<JobDetail>(['job', jobId])
    if (cachedJob?.status === 'completed') {
      if (markProfileCompletionHandled(datasetId, jobId)) {
        invalidateProfileAfterJob(qc, datasetId)
      }
      return
    }

    queueMicrotask(() => setActiveJobId((current) => (current === jobId ? current : jobId)))
  }, [profileQ.error, datasetId, qc])

  useEffect(() => {
    queueMicrotask(() => setActiveJobId(null))
  }, [datasetId])

  const jobQ = useQuery({
    queryKey: ['job', activeJobId],
    queryFn: () => api.getJob(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      if (!s) return nextJobPollIntervalMs(0)
      if (s !== 'queued' && s !== 'running') return false
      const attempts = Math.max(0, q.state.dataUpdateCount - 1)
      return nextJobPollIntervalMs(attempts)
    },
  })

  useEffect(() => {
    const status = jobQ.data?.status
    if (!status || !activeJobId || !datasetId) return
    if (status === 'completed') {
      if (markProfileCompletionHandled(datasetId, activeJobId)) {
        invalidateProfileAfterJob(qc, datasetId)
      }
      queueMicrotask(() => setActiveJobId(null))
    }
    if (status === 'failed' || status === 'canceled') {
      queueMicrotask(() => setActiveJobId(null))
    }
  }, [activeJobId, jobQ.data?.status, qc, datasetId])

  const jobStatus = jobQ.data?.status
  const jobRunning = jobStatus === 'queued' || jobStatus === 'running'

  const isPendingProfile =
    !profileQ.isError &&
    (profileQ.isLoading ||
      (profileQ.isFetching && !profileQ.data) ||
      (!!activeJobId && (jobRunning || jobQ.isLoading)))

  const jobProgress = jobQ.data?.progress

  const refresh = useCallback(() => {
    if (!datasetId || jobRunning) return
    void api.refreshProfile(datasetId).then((job) => setActiveJobId(job.job_id))
  }, [datasetId, jobRunning])

  const cancelRefresh = useCallback(() => {
    if (!activeJobId) return
    void api.cancelJob(activeJobId)
  }, [activeJobId])

  return {
    data: profileQ.data as DatasetProfile | undefined,
    isLoading: profileQ.isLoading,
    isError:
      profileQ.isError &&
      !(
        profileQ.error instanceof ApiRequestError && profileQ.error.code === 'PROFILE_NOT_READY'
      ),
    error: profileQ.error,
    isPendingProfile,
    runningRefresh: jobRunning,
    jobProgress,
    refresh,
    cancelRefresh,
    refetch: profileQ.refetch,
    dataUpdatedAt: profileQ.dataUpdatedAt,
  }
}

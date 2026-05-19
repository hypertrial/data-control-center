import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { DatasetProfile } from '@/api/types'

export function useDatasetProfile(datasetId: string | null | undefined) {
  const qc = useQueryClient()
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null)

  const profileQ = useQuery({
    queryKey: ['profile', datasetId],
    queryFn: () => api.fetchDatasetProfile(datasetId!),
    enabled: !!datasetId,
  })

  const refreshJobQ = useQuery({
    queryKey: ['job', refreshJobId],
    queryFn: () => api.getJob(refreshJobId!),
    enabled: !!refreshJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      if (!s) return 1200
      return s === 'queued' || s === 'running' ? 1200 : false
    },
  })

  useEffect(() => {
    const status = refreshJobQ.data?.status
    if (!status) return
    if (status === 'completed') {
      void qc.invalidateQueries({ queryKey: ['profile', datasetId] })
      void qc.invalidateQueries({ queryKey: ['quality', datasetId] })
      void qc.invalidateQueries({ queryKey: ['profile-history', datasetId] })
      void qc.invalidateQueries({ queryKey: ['datasets'] })
      queueMicrotask(() => setRefreshJobId(null))
    }
    if (status === 'failed' || status === 'canceled') {
      queueMicrotask(() => setRefreshJobId(null))
    }
  }, [refreshJobQ.data?.status, qc, datasetId])

  const runningRefresh =
    refreshJobQ.data?.status === 'queued' || refreshJobQ.data?.status === 'running'

  const isPendingProfile =
    profileQ.isLoading || profileQ.isFetching || runningRefresh

  const refresh = useCallback(() => {
    if (!datasetId || runningRefresh) return
    void api.refreshProfile(datasetId).then((job) => setRefreshJobId(job.job_id))
  }, [datasetId, runningRefresh])

  const cancelRefresh = useCallback(() => {
    if (!refreshJobId) return
    void api.cancelJob(refreshJobId)
  }, [refreshJobId])

  return {
    data: profileQ.data as DatasetProfile | undefined,
    isLoading: profileQ.isLoading,
    isError: profileQ.isError,
    error: profileQ.error,
    isPendingProfile,
    runningRefresh,
    refresh,
    cancelRefresh,
    refetch: profileQ.refetch,
    dataUpdatedAt: profileQ.dataUpdatedAt,
  }
}

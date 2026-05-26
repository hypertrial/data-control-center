import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiRequestError } from '@/api/client'
import { resetDatasetProfileJobStateForTests, useDatasetProfile } from '@/hooks/useDatasetProfile'
import { mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({
  fetchDatasetProfileOnce: vi.fn(),
  getJob: vi.fn(),
  refreshProfile: vi.fn(),
  cancelJob: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      fetchDatasetProfileOnce: h.fetchDatasetProfileOnce,
      getJob: h.getJob,
      refreshProfile: h.refreshProfile,
      cancelJob: h.cancelJob,
    },
  }
})

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useDatasetProfile', () => {
  beforeEach(() => {
    resetDatasetProfileJobStateForTests()
    vi.clearAllMocks()
    h.fetchDatasetProfileOnce.mockResolvedValue(mkProfile())
    h.getJob.mockResolvedValue({ job_id: 'j1', status: 'completed', kind: 'profile_refresh' })
    h.refreshProfile.mockResolvedValue({ job_id: 'j2', status: 'queued' })
  })

  it('queues job polling when profile is not ready', async () => {
    h.fetchDatasetProfileOnce.mockRejectedValue(
      new ApiRequestError('Profiling', 'PROFILE_NOT_READY', { job_id: 'j-pending' }),
    )
    h.getJob.mockResolvedValue({ job_id: 'j-pending', status: 'completed', kind: 'dataset_prepare' })
    renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(h.getJob).toHaveBeenCalled())
    await waitFor(() => expect(h.fetchDatasetProfileOnce.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('surfaces generic fetch errors', async () => {
    h.fetchDatasetProfileOnce.mockRejectedValue(new Error('e1'))
    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('e1')
    expect(result.current.isPendingProfile).toBe(false)
  })

  it('loads profile for dataset id', async () => {
    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(h.fetchDatasetProfileOnce).toHaveBeenCalledWith(
      'ds_1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('keeps recently loaded profiles fresh across quick remounts', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )

    const first = renderHook(() => useDatasetProfile('ds_1'), { wrapper: localWrapper })
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    first.unmount()
    renderHook(() => useDatasetProfile('ds_1'), { wrapper: localWrapper })

    expect(h.fetchDatasetProfileOnce).toHaveBeenCalledTimes(1)
  })

  it('refresh queues job', async () => {
    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    result.current.refresh()
    expect(h.refreshProfile).toHaveBeenCalledWith('ds_1')
  })

  it('invalidates profile caches when the refresh job completes', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateQueries = vi.spyOn(qc, 'invalidateQueries')
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )

    h.refreshProfile.mockResolvedValue({ job_id: 'j-refresh', status: 'queued' })
    h.getJob.mockResolvedValue({ job_id: 'j-refresh', status: 'completed', kind: 'profile_refresh' })

    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper: localWrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    result.current.refresh()

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['profile', 'ds_1'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['datasets'] })
    })
  })

  it('does not spam profile refetches when the job is already completed in cache', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    qc.setQueryData(['job', 'j-done'], {
      job_id: 'j-done',
      status: 'completed',
      kind: 'dataset_prepare',
    })
    h.fetchDatasetProfileOnce
      .mockRejectedValueOnce(
        new ApiRequestError('Profiling', 'PROFILE_NOT_READY', { job_id: 'j-done' }),
      )
      .mockResolvedValue(mkProfile())

    renderHook(
      () => {
        useDatasetProfile('ds_1')
        useDatasetProfile('ds_1')
      },
      { wrapper: localWrapper },
    )

    await waitFor(() => expect(h.fetchDatasetProfileOnce.mock.calls.length).toBeGreaterThanOrEqual(2))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(h.fetchDatasetProfileOnce.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('deduplicates completed job invalidations across profile consumers', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateQueries = vi.spyOn(qc, 'invalidateQueries')
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    h.fetchDatasetProfileOnce.mockRejectedValue(
      new ApiRequestError('Profiling', 'PROFILE_NOT_READY', { job_id: 'j-shared-complete' }),
    )
    h.getJob.mockResolvedValue({ job_id: 'j-shared-complete', status: 'completed', kind: 'dataset_prepare' })

    renderHook(
      () => {
        useDatasetProfile('ds_1')
        useDatasetProfile('ds_1')
      },
      { wrapper: localWrapper },
    )

    await waitFor(() => expect(h.getJob).toHaveBeenCalled())
    await waitFor(() => {
      expect(
        invalidateQueries.mock.calls.filter(([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: ['datasets'] })),
      ).toHaveLength(1)
    })
  })

  it('clears the refresh job when it fails', async () => {
    h.refreshProfile.mockResolvedValue({ job_id: 'j-fail', status: 'queued' })
    h.getJob.mockResolvedValue({ job_id: 'j-fail', status: 'failed', kind: 'profile_refresh' })

    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    result.current.refresh()

    await waitFor(() => expect(h.getJob).toHaveBeenCalled())
  })

  it('cancelRefresh calls cancelJob for the active job', async () => {
    h.refreshProfile.mockResolvedValue({ job_id: 'j-cancel', status: 'queued' })
    h.getJob.mockResolvedValue({ job_id: 'j-cancel', status: 'running', kind: 'profile_refresh' })

    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    result.current.refresh()
    await waitFor(() => expect(result.current.runningRefresh).toBe(true))

    result.current.cancelRefresh()
    expect(h.cancelJob).toHaveBeenCalledWith('j-cancel')
  })
})

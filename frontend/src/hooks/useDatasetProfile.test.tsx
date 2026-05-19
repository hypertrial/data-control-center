import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({
  fetchDatasetProfile: vi.fn(),
  getJob: vi.fn(),
  refreshProfile: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: {
    fetchDatasetProfile: h.fetchDatasetProfile,
    getJob: h.getJob,
    refreshProfile: h.refreshProfile,
    cancelJob: vi.fn(),
  },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useDatasetProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.fetchDatasetProfile.mockResolvedValue(mkProfile())
    h.getJob.mockResolvedValue({ job_id: 'j1', status: 'completed', kind: 'profile_refresh' })
    h.refreshProfile.mockResolvedValue({ job_id: 'j2', status: 'queued' })
  })

  it('loads profile for dataset id', async () => {
    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(h.fetchDatasetProfile).toHaveBeenCalledWith('ds_1')
  })

  it('refresh queues job', async () => {
    const { result } = renderHook(() => useDatasetProfile('ds_1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    result.current.refresh()
    expect(h.refreshProfile).toHaveBeenCalledWith('ds_1')
  })
})

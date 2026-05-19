import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverviewPageData } from '@/features/overview/useOverviewPageData'
import { useUiStore } from '@/store/uiStore'
import { mkColumn, mkIssue, mkProfile } from '@/test/profileFixtures'

const profileState = vi.hoisted(() => ({
  data: undefined as ReturnType<typeof mkProfile> | undefined,
  isPendingProfile: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}))

vi.mock('@/hooks/useDatasetProfile', () => ({
  useDatasetProfile: () => profileState,
}))

const h = vi.hoisted(() => ({ getProfileHistory: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, getProfileHistory: h.getProfileHistory } }
})

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useOverviewPageData', () => {
  beforeEach(() => {
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    profileState.data = mkProfile({
      column_profiles: [
        mkColumn({ name: 'a', null_pct: 0.2 }),
        mkColumn({ name: 'b', null_pct: 0.8 }),
      ],
      quality_issues: [mkIssue({ id: 'i1', score_impact: 5 }), mkIssue({ id: 'i2', score_impact: 10 })],
    })
    h.getProfileHistory.mockResolvedValue([
      { quality_score: 80 },
      { quality_score: 90 },
    ])
  })

  it('derives trend, top null columns, and top issues', async () => {
    const { result } = renderHook(() => useOverviewPageData(), { wrapper })
    await waitFor(() => expect(result.current.trend).toBe(-10))
    expect(result.current.topNull.names).toEqual(['b', 'a'])
    expect(result.current.topNull.values).toEqual([0.8, 0.2])
    expect(result.current.topIssues.map((i) => i.score_impact)).toEqual([10, 5])
  })
})

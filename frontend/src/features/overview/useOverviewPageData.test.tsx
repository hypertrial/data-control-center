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
  dataUpdatedAt: 1_700_000_000_000,
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
      rows: 100,
      columns: 4,
      missing_cell_pct: 10,
      column_profiles: [
        mkColumn({ name: 'a', null_pct: 0.2 }),
        mkColumn({ name: 'b', null_pct: 0.8 }),
        mkColumn({ name: 'c', null_pct: 0.5 }),
        mkColumn({ name: 'd', null_pct: 0.1 }),
        mkColumn({ name: 'e', null_pct: 0.9 }),
        mkColumn({ name: 'f', null_pct: 0.7 }),
      ],
      quality_issues: [mkIssue({ id: 'i1', score_impact: 5 }), mkIssue({ id: 'i2', score_impact: 10 })],
    })
    profileState.dataUpdatedAt = 1_700_000_000_000
    h.getProfileHistory.mockResolvedValue([
      { quality_score: 80 },
      { quality_score: 90 },
    ])
  })

  it('derives trend, completeness stats, and split null rankings', async () => {
    const { result } = renderHook(() => useOverviewPageData(), { wrapper })
    await waitFor(() => expect(result.current.trend).toBe(-10))
    expect(result.current.hasHistoryTrend).toBe(true)
    expect(result.current.profileUpdatedAt).toBe(1_700_000_000_000)
    expect(result.current.completenessStats?.populatedPct).toBe(90)
    expect(result.current.topNullCompact.names).toHaveLength(5)
    expect(result.current.topNullFull.names).toHaveLength(6)
    expect(result.current.topNullCompact.names[0]).toBe('e')
    expect(result.current.topIssues.map((i) => i.score_impact)).toEqual([10, 5])
  })

  it('reports no history trend when fewer than two snapshots', async () => {
    h.getProfileHistory.mockResolvedValue([{ quality_score: 80 }])
    const { result } = renderHook(() => useOverviewPageData(), { wrapper })
    await waitFor(() => expect(result.current.hasHistoryTrend).toBe(false))
    expect(result.current.trend).toBeNull()
  })
})

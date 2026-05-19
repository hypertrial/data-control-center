import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnsTable } from '@/features/columns/useColumnsTable'
import { useUiStore } from '@/store/uiStore'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

const profileState = vi.hoisted(() => ({
  data: undefined as ReturnType<typeof mkProfile> | undefined,
  isPendingProfile: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
  refresh: vi.fn(),
  cancelRefresh: vi.fn(),
}))

vi.mock('@/hooks/useDatasetProfile', () => ({
  useDatasetProfile: () => profileState,
}))

const h = vi.hoisted(() => ({ listDatasets: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, listDatasets: h.listDatasets } }
})

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useColumnsTable', () => {
  beforeEach(() => {
    useUiStore.setState({
      activeDatasetId: 'ds_1',
      columnSearch: '',
      semanticFilter: 'all',
      columnQualityFilter: 'all',
      selectedColumn: null,
      columnDrawerOpen: false,
    })
    profileState.data = mkProfile({
      column_profiles: [
        mkColumn({ name: 'alpha', null_pct: 0.1, semantic_type: 'categorical', quality_flags: [] }),
        mkColumn({
          name: 'beta',
          null_pct: 0.9,
          semantic_type: 'numeric',
          quality_flags: ['high_missingness'],
        }),
      ],
    })
    profileState.isPendingProfile = false
    h.listDatasets.mockResolvedValue([
      {
        dataset_id: 'ds_1',
        name: 'a.csv',
        view_name: 'v1',
        source_path: 'a.csv',
        format: 'csv',
        row_count: 1,
        column_count: 2,
        file_size_bytes: 1,
      },
    ])
  })

  it('filters rows by column search', async () => {
    useUiStore.setState({ columnSearch: 'alp' })
    const { result } = renderHook(() => useColumnsTable(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data[0]?.name).toBe('alpha')
    expect(result.current.summaryParts[0]).toContain('alp')
  })

  it('filters critical quality flags only', async () => {
    useUiStore.setState({ columnQualityFilter: 'critical_only' })
    const { result } = renderHook(() => useColumnsTable(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data[0]?.name).toBe('beta')
  })
})

import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from '@/features/shell/TopBar'
import { useUiStore } from '@/store/uiStore'
import { mkProfile } from '@/test/profileFixtures'
import { TooltipProvider } from '@/components/ui/tooltip'

const h = vi.hoisted(() => ({
  listDatasets: vi.fn(),
  getProfile: vi.fn(),
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
      listDatasets: h.listDatasets,
      getProfile: h.getProfile, fetchDatasetProfile: h.getProfile,
      getJob: h.getJob,
      refreshProfile: h.refreshProfile,
      cancelJob: h.cancelJob,
    },
  }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TooltipProvider delayDuration={280}>{ui}</TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.listDatasets.mockResolvedValue([
      {
        dataset_id: 'ds_x',
        name: 'short.parquet',
        view_name: 'short',
        source_path: '/data/short.parquet',
        format: 'parquet',
        row_count: 100,
        column_count: 10,
        file_size_bytes: 5000,
        quality_score: 72,
      },
    ])
    h.getProfile.mockResolvedValue(
      mkProfile({
        dataset_id: 'ds_x',
        name: 'short.parquet',
        rows: 100,
        columns: 10,
        file_size_bytes: 5000,
        quality_score: 72,
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_x' })
  })

  it('shows dataset name with title for long truncation target', async () => {
    const long = 'player_ratings_2022_2026_and_more_suffix.parquet'
    h.listDatasets.mockResolvedValue([
      {
        dataset_id: 'ds_x',
        name: long,
        view_name: 'v',
        source_path: `/data/${long}`,
        format: 'parquet',
        row_count: 101_048,
        column_count: 54,
        file_size_bytes: 5_000_000,
        quality_score: 59,
      },
    ])
    h.getProfile.mockResolvedValue(
      mkProfile({
        dataset_id: 'ds_x',
        name: long,
        rows: 101_048,
        columns: 54,
        file_size_bytes: 5_000_000,
        quality_score: 59,
      }),
    )

    wrap(<TopBar />)

    const heading = await waitFor(() => screen.getByRole('heading', { level: 1, name: long }))
    expect(heading).toHaveAttribute('title', long)
  })

  it('disables refresh when no active dataset', () => {
    useUiStore.setState({ activeDatasetId: null })
    wrap(<TopBar />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled()
  })
})

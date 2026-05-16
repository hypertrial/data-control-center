import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { useUiStore } from '@/store/uiStore'
import { mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({ getProfile: vi.fn(), getProfileHistory: vi.fn() }))

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, getProfile: h.getProfile, getProfileHistory: h.getProfileHistory } }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('OverviewPage', () => {
  beforeEach(() => {
    h.getProfileHistory.mockResolvedValue([
      { history_id: 'h1', dataset_id: 'ds_001', created_at: 't', quality_score: 90, rows: 1, columns: 1, missing_cell_pct: 0 },
      { history_id: 'h2', dataset_id: 'ds_001', created_at: 't2', quality_score: 88, rows: 1, columns: 1, missing_cell_pct: 0 },
    ])
  })

  it('prompts when no dataset', () => {
    wrap(<OverviewPage />)
    expect(screen.getByText(/Select a dataset from the sidebar/i)).toBeInTheDocument()
  })

  it('loads profile when active', async () => {
    h.getProfile.mockResolvedValue(mkProfile({ file_size_bytes: 100, narrative: '**Hello** world' }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/100 B/)).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 2, name: 'Profile snapshot' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Quality focus' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Column mix' })).toBeInTheDocument()
    expect(screen.getByText(/100 B/)).toBeInTheDocument()
  })

  it('renders structure summary (entity + row grain)', async () => {
    h.getProfile.mockResolvedValue(
      mkProfile({
        primary_grain_key_columns: ['player_id', 'year'],
        likely_grain: 'One row per player_id + year.',
        primary_temporal_column: { name: 'year', kind: 'discrete_period', confidence: 'high' },
        temporal_columns: [{ name: 'year', kind: 'discrete_period', confidence: 'high' }],
        entity_id_columns: [{ name: 'player_id', confidence: 'high' }],
        measure_candidates: [{ name: 'overall', score: 0.9, confidence: 'high' }],
        structure_warnings: ['Primary grain key confidence is medium (sample-based uniqueness).'],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/Primary grain key confidence is medium/i)).toBeInTheDocument())
    expect(screen.getByText('Entities')).toBeInTheDocument()
    expect(screen.getByText('Grain cols')).toBeInTheDocument()
    expect(screen.getByText('Row grain')).toBeInTheDocument()
    expect(screen.getAllByText('player_id').length).toBeGreaterThan(0)
    expect(screen.getAllByText('year').length).toBeGreaterThan(0)
    expect(screen.getByText(/discrete period/)).toBeInTheDocument()
  })

  it('formatBytes scales', async () => {
    h.getProfile.mockResolvedValue(
      mkProfile({
        file_size_bytes: 10_000,
        quality_score: null,
        likely_grain: null,
        primary_date_column: null,
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/9\.8 KB/)).toBeInTheDocument())
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows loading', () => {
    h.getProfile.mockImplementation(() => new Promise(() => {}))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0)
  })

  it('formatBytes MB', async () => {
    h.getProfile.mockResolvedValue(mkProfile({ file_size_bytes: 3 * 1024 * 1024 }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/3\.0 MB/)).toBeInTheDocument())
  })

  it('formatBytes GB', async () => {
    h.getProfile.mockResolvedValue(mkProfile({ file_size_bytes: 2 * 1024 ** 3 }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/2\.0 GB/)).toBeInTheDocument())
  })

  it('structure summary shows overflow for many main measures', async () => {
    const measures = Array.from({ length: 12 }, (_, i) => ({
      name: `measure_col_${i}`,
      score: 0.5,
      confidence: 'high' as const,
    }))
    h.getProfile.mockResolvedValue(mkProfile({ measure_candidates: measures }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText('+4 more')).toBeInTheDocument())
    expect(
      screen.getByTitle('measure_col_8, measure_col_9, measure_col_10, measure_col_11'),
    ).toBeInTheDocument()
  })

  it('shows error state', async () => {
    h.getProfile.mockRejectedValue(new Error('boom'))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})

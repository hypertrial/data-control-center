import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { useUiStore } from '@/store/uiStore'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({ fetchDatasetProfile: vi.fn(), getProfileHistory: vi.fn() }))
const chartFns = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
}))

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: chartFns.on,
    off: chartFns.off,
  })),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, fetchDatasetProfile: h.fetchDatasetProfile, getProfileHistory: h.getProfileHistory } }
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
    chartFns.on.mockReset()
    chartFns.off.mockReset()
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
    h.fetchDatasetProfile.mockResolvedValue(mkProfile({ file_size_bytes: 100, narrative: '**Hello** world' }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/100 B/)).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 2, name: 'Profile snapshot' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Quality focus' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Column mix' })).toBeInTheDocument()
    expect(screen.getByText('Profile summary')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText(/cells populated/i)).toBeInTheDocument()
  })

  it('renders structure summary (entity + row grain)', async () => {
    h.fetchDatasetProfile.mockResolvedValue(
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
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        file_size_bytes: 10_000,
        quality_score: null,
        likely_grain: null,
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/9\.8 KB/)).toBeInTheDocument())
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows loading', () => {
    h.fetchDatasetProfile.mockImplementation(() => new Promise(() => {}))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0)
  })

  it('formatBytes MB', async () => {
    h.fetchDatasetProfile.mockResolvedValue(mkProfile({ file_size_bytes: 3 * 1024 * 1024 }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/3\.0 MB/)).toBeInTheDocument())
  })

  it('formatBytes GB', async () => {
    h.fetchDatasetProfile.mockResolvedValue(mkProfile({ file_size_bytes: 2 * 1024 ** 3 }))
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
    h.fetchDatasetProfile.mockResolvedValue(mkProfile({ measure_candidates: measures }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText('+4 more')).toBeInTheDocument())
    expect(
      screen.getByTitle('measure_col_8, measure_col_9, measure_col_10, measure_col_11'),
    ).toBeInTheDocument()
  })

  it('shows error state', async () => {
    h.fetchDatasetProfile.mockRejectedValue(new Error('boom'))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })

  it('labels duplicate rows as sample-based when profiler scope is sample', async () => {
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        duplicate_row_pct: 2,
        duplicate_row_pct_scope: 'sample',
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/Duplicate rows \(sample\)/i)).toBeInTheDocument())
  })

  it('shows no prior snapshot when profile history has one entry', async () => {
    h.getProfileHistory.mockResolvedValue([{ quality_score: 80 }])
    h.fetchDatasetProfile.mockResolvedValue(mkProfile())
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText('No prior snapshot')).toBeInTheDocument())
  })

  it('navigates to flagged columns from completeness panel', async () => {
    const user = userEvent.setup()
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        column_profiles: [mkColumn({ name: 'amount', null_pct: 50, quality_flags: ['high_missingness'] })],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001', columnQualityFilter: 'all', columnSearch: 'x' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /View flagged columns/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /View flagged columns/i }))
    expect(useUiStore.getState().columnQualityFilter).toBe('critical_only')
    expect(useUiStore.getState().columnSearch).toBe('')
  })

  it('labels duplicate rows as full-table when profiler scope is full', async () => {
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        duplicate_row_pct: 2,
        duplicate_row_pct_scope: 'full',
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText('Duplicate rows')).toBeInTheDocument())
    expect(screen.queryByText(/Duplicate rows \(sample\)/i)).not.toBeInTheDocument()
  })

  it('opens the diff dialog and renders empty chart fallbacks', async () => {
    const user = userEvent.setup()
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        columns: 0,
        numeric_column_count: 0,
        categorical_column_count: 0,
        datetime_column_count: 0,
        quality_score: 40,
        quality_issues: [],
        column_profiles: [],
        missing_cell_pct: null,
        duplicate_row_pct: null,
        primary_temporal_column: null,
        structure_warnings: [],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)

    await waitFor(() => expect(screen.getByText(/No column metadata/i)).toBeInTheDocument())
    expect(screen.getByText(/No quality issues detected/i)).toBeInTheDocument()
    expect(screen.getAllByText(/No column stats/i).length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByRole('button', { name: /What changed/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('uses fallback structure columns and wires issue-click handlers', async () => {
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        entity_id_columns: [{ name: 'account_id', confidence: 'high' }],
        primary_grain_key_columns: ['account_id', 'month'],
        measure_candidates: [],
        main_numeric_measures: ['m1', 'm2'],
        primary_temporal_column: { name: 'month', kind: 'discrete_period', confidence: 'high' },
        quality_issues: [
          {
            id: 'nulls',
            severity: 'warning',
            category: 'missingness',
            title: 'Many nulls',
            description: 'Many nulls in amount',
            why_it_matters: 'Aggregates can be biased.',
            affected_columns: ['amount'],
            examples: [],
            suggested_sql: null,
            score_impact: 7.5,
          },
        ],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)

    await waitFor(() => expect(screen.getAllByText('account_id').length).toBeGreaterThan(0))
    expect(screen.getAllByText('month').length).toBeGreaterThan(0)
    expect(screen.getByText('m1')).toBeInTheDocument()
    expect(chartFns.on).toHaveBeenCalledWith('click', expect.any(Function))
  })
})

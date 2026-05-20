import { MemoryRouter } from 'react-router-dom'
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ColumnsPage } from '@/features/columns/ColumnsPage'
import { useUiStore } from '@/store/uiStore'
import { mkColumn, mkProfile } from '@/test/profileFixtures'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

const h = vi.hoisted(() => ({ fetchDatasetProfile: vi.fn(), listDatasets: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, fetchDatasetProfile: h.fetchDatasetProfile, listDatasets: h.listDatasets } }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('ColumnsPage', () => {
  beforeEach(() => {
    useUiStore.setState({
      columnsTableHidden: {},
      columnSearch: '',
      semanticFilter: 'all',
      columnQualityFilter: 'all',
      columnsDensity: 'comfortable',
    })
    h.listDatasets.mockResolvedValue([
      {
        dataset_id: 'ds_1',
        name: 'fixture.csv',
        view_name: 'fixture',
        source_path: '/p/fixture.csv',
        format: 'csv',
        row_count: 1,
        column_count: 2,
        file_size_bytes: 1,
      },
    ])
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        column_profiles: [
          mkColumn({ name: 'alpha', semantic_type: 'numeric', quality_flags: [] }),
          mkColumn({
            name: 'beta',
            semantic_type: 'text',
            physical_type: 'Utf8',
            top_value: 'hello',
            top_count: 8,
            top_pct: 80,
            unique_pct: 45.5,
            mean_value: null,
            std_value: null,
            median_value: null,
            p25_value: null,
            p75_value: null,
            quality_flags: [],
          }),
        ],
      }),
    )
  })

  it('no dataset', () => {
    wrap(<ColumnsPage />)
    expect(screen.getByText(/Select a dataset/)).toBeInTheDocument()
  })

  it('loading', () => {
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    h.fetchDatasetProfile.mockImplementation(() => new Promise(() => {}))
    wrap(<ColumnsPage />)
    expect(screen.getByRole('status', { name: /loading table/i })).toBeInTheDocument()
  })

  it('error', async () => {
    h.fetchDatasetProfile.mockRejectedValue(new Error('e1'))
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByText('e1')).toBeInTheDocument())
  })

  it('keeps column headers sticky inside a scrollable table container', async () => {
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    const thead = screen.getByRole('columnheader', { name: /^Column/ }).closest('thead')
    expect(thead).toHaveClass('sticky', 'top-0')
    const scrollContainer = screen.getByRole('table').parentElement
    expect(scrollContainer).toHaveClass('overflow-auto', 'max-h-[calc(100vh-12rem)]')
  })

  it('shows unique counts with percent and EDA summary tooltip', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getAllByText(/100\.00%/).length).toBeGreaterThanOrEqual(1)
    await user.hover(screen.getByRole('button', { name: 'EDA sample details' }))
    await waitFor(() =>
      expect(screen.getAllByText(/EDA stats use all 10 rows/).length).toBeGreaterThanOrEqual(1),
    )
  })

  it('labels sampled uniqueness metrics', async () => {
    const user = userEvent.setup()
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        rows: 5_000,
        profiler_sample_rows: 2_000,
        column_profiles: [
          mkColumn({
            name: 'sampled_col',
            metric_scope: 'sample',
            top_value: 'a',
            top_count: 20,
            top_pct: 1,
          }),
        ],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getAllByText('sample').length).toBeGreaterThanOrEqual(1)
    await user.hover(screen.getByRole('button', { name: 'EDA sample details' }))
    await waitFor(() => expect(screen.getAllByText(/first 2,000 rows/).length).toBeGreaterThanOrEqual(1))
  })

  it('shows Role badges from dataset profile structure metadata', async () => {
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        primary_grain_key_columns: ['player_id', 'season_year'],
        entity_id_columns: [{ name: 'player_id', confidence: 'high' }],
        primary_temporal_column: { name: 'season_year', kind: 'discrete_period', confidence: 'high' },
        temporal_columns: [{ name: 'season_year', kind: 'discrete_period', confidence: 'high' }],
        measure_candidates: [{ name: 'goals', score: 0.9, confidence: 'high' }],
        column_profiles: [
          mkColumn({ name: 'player_id', semantic_type: 'id_like' }),
          mkColumn({ name: 'season_year', semantic_type: 'categorical' }),
          mkColumn({ name: 'goals', semantic_type: 'numeric' }),
          mkColumn({ name: 'pace', semantic_type: 'numeric' }),
          mkColumn({ name: 'notes', semantic_type: 'text' }),
        ],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const grid = screen.getByRole('table')
    const rows = within(grid).getAllByRole('row')
    const dataRows = rows.filter((r) => within(r).queryAllByRole('cell').length > 0)

    const rowFor = (name: string): HTMLElement => {
      const r = dataRows.find((row) => within(row).queryByText(name))
      expect(r).toBeTruthy()
      return r as HTMLElement
    }

    expect(within(rowFor('player_id')).getByText('grain key')).toBeInTheDocument()
    expect(within(rowFor('player_id')).getByText('entity id')).toBeInTheDocument()

    expect(within(rowFor('season_year')).getByText('grain key')).toBeInTheDocument()
    expect(within(rowFor('season_year')).getByText('time')).toBeInTheDocument()

    expect(within(rowFor('goals')).getByText('measure')).toBeInTheDocument()
    expect(within(rowFor('pace')).getByText('measure')).toBeInTheDocument()

    const notesRow = rowFor('notes')
    expect(within(notesRow).queryByText('grain key')).toBeNull()
    expect(within(notesRow).queryByText('entity id')).toBeNull()
    expect(within(notesRow).queryByText('time')).toBeNull()
    expect(within(notesRow).queryByText('measure')).toBeNull()
  })

  it('hides Role column when no roles exist in dataset', async () => {
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        primary_grain_key_columns: [],
        entity_id_columns: [],
        temporal_columns: [],
        measure_candidates: [],
        main_numeric_measures: [],
        primary_temporal_column: null,
        column_profiles: [mkColumn({ name: 'plain', semantic_type: 'text', quality_flags: [] })],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.queryByRole('columnheader', { name: /^Role/ })).toBeNull()
  })

  it('does not show a Top column in the table', async () => {
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.queryByRole('columnheader', { name: /^Top/ })).toBeNull()
  })

  it('truncates long column names but keeps full title', async () => {
    const long = 'world_cup_squad_tournament_year_extra_suffix_for_test'
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        column_profiles: [mkColumn({ name: long, semantic_type: 'text', quality_flags: [] })],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByTitle(long)).toBeInTheDocument())
  })

  it('shows physical type under column name and no separate Type header', async () => {
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getAllByText('Int64').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('columnheader', { name: /^Type/ })).toBeNull()
  })

  it('shows structured distribution stats and no separate range column for numeric columns', async () => {
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.queryByRole('columnheader', { name: /^Range/ })).toBeNull()
    expect(screen.getByRole('columnheader', { name: /^Distribution/ })).toBeInTheDocument()
    expect(screen.getAllByText('range').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('IQR').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('median').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('mean').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('STDEV').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('0 -> 9').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('2 -> 7').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('tints rows with critical quality flags', async () => {
    h.fetchDatasetProfile.mockResolvedValue(
      mkProfile({
        column_profiles: [mkColumn({ name: 'flagged', quality_flags: ['high_missingness'] })],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    const row = screen.getByText('flagged').closest('tr')
    expect(row).toHaveAttribute('data-severity', 'critical')
  })

  it('filters sorts and opens drawer', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ activeDatasetId: 'ds_1', columnSearch: '', semanticFilter: 'all' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const search = screen.getByPlaceholderText(/Column name/)
    await user.type(search, 'alp')
    expect(screen.queryByText('beta')).toBeNull()

    await user.clear(search)
    await user.click(screen.getByRole('button', { name: /Type:/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Text' }))
    expect(screen.queryByText('alpha')).toBeNull()

    await user.click(screen.getByRole('button', { name: /Type:/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'All types' }))
    const grid = screen.getByRole('table')
    const sortBtn = within(grid).getByRole('button', { name: /^Column/ })
    await user.click(sortBtn)

    const row = screen.getByText('beta').closest('tr')
    expect(row).toBeTruthy()
    await user.click(row!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument())
  })
})

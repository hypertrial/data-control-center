import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChartsPage } from '@/features/charts/ChartsPage'
import { useUiStore } from '@/store/uiStore'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispatchAction: vi.fn(),
    getDataURL: vi.fn(() => 'data:image/png;base64,test'),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

const h = vi.hoisted(() => ({
  listDatasets: vi.fn(),
  fetchDatasetProfile: vi.fn(),
  fetchDatasetProfileOnce: vi.fn(),
  runQuery: vi.fn(),
  listSavedCharts: vi.fn(),
  createSavedChart: vi.fn(),
  patchSavedChart: vi.fn(),
  deleteSavedChart: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listDatasets: h.listDatasets,
      fetchDatasetProfile: h.fetchDatasetProfile,
      fetchDatasetProfileOnce: h.fetchDatasetProfileOnce,
      runQuery: h.runQuery,
      listSavedCharts: h.listSavedCharts,
      createSavedChart: h.createSavedChart,
      patchSavedChart: h.patchSavedChart,
      deleteSavedChart: h.deleteSavedChart,
    },
  }
})

function wrap(ui: React.ReactElement, entry = '/charts') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={qc}>
        <TooltipProvider delayDuration={280}>{ui}</TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const dsRow = {
  dataset_id: 'ds_001',
  name: 'orders.csv',
  view_name: 'orders',
  source_path: '/p/orders.csv',
  format: 'csv',
  row_count: 24,
  column_count: 3,
  file_size_bytes: 100,
}

function chartableProfile() {
  return mkProfile({
    dataset_id: 'ds_001',
    name: 'Orders',
    primary_temporal_column: { name: 'order_date', kind: 'continuous_datetime', confidence: 'high' },
    temporal_columns: [{ name: 'order_date', kind: 'continuous_datetime', confidence: 'high' }],
    measure_candidates: [
      { name: 'revenue', score: 0.9, confidence: 'high' },
      { name: 'profit', score: 0.8, confidence: 'high' },
    ],
    column_profiles: [
      mkColumn({ name: 'order_date', semantic_type: 'datetime' }),
      mkColumn({ name: 'revenue', semantic_type: 'numeric' }),
      mkColumn({ name: 'profit', semantic_type: 'numeric' }),
      mkColumn({ name: 'region', semantic_type: 'categorical', cardinality: 30 }),
    ],
  })
}

describe('ChartsPage', () => {
  beforeEach(() => {
    h.listDatasets.mockResolvedValue([dsRow])
    h.fetchDatasetProfileOnce.mockResolvedValue(chartableProfile())
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'bin_index', type: null }, { name: 'lower_bound', type: null }, { name: 'upper_bound', type: null }, { name: 'count', type: null }],
      rows: [{ bin_index: 0, lower_bound: 0, upper_bound: 10, count: 4 }],
      row_count: 1,
      truncated: false,
      error: null,
    })
    h.listSavedCharts.mockResolvedValue([])
    h.createSavedChart.mockImplementation(async (body) => ({
      chart_id: 'chart_1', dataset_id: body.dataset_id, name: body.name,
      description: body.description ?? null, spec: body.spec, created_at: 'now', updated_at: 'now',
    }))
    h.patchSavedChart.mockImplementation(async (chartId, body) => ({
      chart_id: chartId, dataset_id: 'ds_001', name: body.name ?? 'Saved chart',
      description: body.description ?? null, spec: body.spec ?? {}, created_at: 'now', updated_at: 'later',
    }))
    h.deleteSavedChart.mockResolvedValue(undefined)
    useUiStore.setState({ activeDatasetId: 'ds_001' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders select-dataset empty state', () => {
    useUiStore.setState({ activeDatasetId: null })
    wrap(<ChartsPage />)
    expect(screen.getByText('Select a dataset.')).toBeInTheDocument()
  })

  it('shows invalid guidance when no numeric variables exist', async () => {
    h.fetchDatasetProfileOnce.mockResolvedValue(
      mkProfile({
        primary_temporal_column: { name: 'created_at', kind: 'continuous_datetime', confidence: 'high' },
        temporal_columns: [{ name: 'created_at', kind: 'continuous_datetime', confidence: 'high' }],
        measure_candidates: [],
        column_profiles: [mkColumn({ name: 'created_at', semantic_type: 'datetime' })],
      }),
    )

    wrap(<ChartsPage />)

    expect(await screen.findByText(/Choose at least one numeric variable/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run chart/i })).not.toBeInTheDocument()
  })

  it('preselects histogram defaults from the profile', async () => {
    wrap(<ChartsPage />)

    await waitFor(() => expect(screen.getByLabelText('Chart type')).toHaveValue('histogram'))
    expect(screen.getByLabelText('Value column')).toHaveValue('revenue')
    expect(screen.getByLabelText('Bins')).toHaveValue(12)
    expect(screen.queryByLabelText('X axis')).not.toBeInTheDocument()
    expect(screen.queryByText('Y variables')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('revenue distribution')).toBeInTheDocument()
    expect(screen.queryByText('Saved Charts')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run chart/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument()
    expect(screen.getByText('Chart').compareDocumentPosition(screen.getByText('Data'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('switches between histogram and line controls', async () => {
    const user = userEvent.setup()
    wrap(<ChartsPage />)

    await user.selectOptions(await screen.findByLabelText('Chart type'), 'line')
    expect(screen.getByLabelText('X axis')).toHaveValue('order_date')
    expect(screen.getByLabelText('revenue')).toBeChecked()
    expect(screen.getByDisplayValue('Orders trends')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Chart type'), 'histogram')
    expect(screen.getByLabelText('Value column')).toHaveValue('revenue')
    expect(screen.queryByLabelText('Aggregation')).not.toBeInTheDocument()
  })

  it('switches to bar chart controls and runs grouped SQL', async () => {
    const user = userEvent.setup()
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'x', type: null }, { name: 'count', type: null }],
      rows: [{ x: 'East', count: 3 }],
      row_count: 1,
      truncated: false,
      error: null,
    })

    wrap(<ChartsPage />)
    await user.selectOptions(await screen.findByLabelText('Chart type'), 'bar')

    expect(screen.getByLabelText('Category')).toHaveValue('region')
    expect(screen.getByLabelText('Top N')).toHaveValue(25)
    expect(screen.queryByLabelText('Bucket')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Aggregation'), 'count')

    await waitFor(() => expect(h.runQuery.mock.calls.at(-1)?.[0].sql.toLowerCase()).toContain('count(*)'))
    expect(h.runQuery.mock.calls.at(-1)?.[0].sql.toLowerCase()).toContain('group by 1')
  })

  it('switches to scatter chart controls and runs row-level SQL', async () => {
    const user = userEvent.setup()
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'x', type: null }, { name: 'y', type: null }],
      rows: [{ x: 1, y: 2 }],
      row_count: 1,
      truncated: false,
      error: null,
    })

    wrap(<ChartsPage />)
    await user.selectOptions(await screen.findByLabelText('Chart type'), 'scatter')

    expect(screen.getByLabelText('X variable')).toHaveValue('revenue')
    expect(screen.getByLabelText('Y variable')).toHaveValue('profit')
    expect(screen.queryByLabelText('Aggregation')).not.toBeInTheDocument()

    await waitFor(() => expect(h.runQuery).toHaveBeenCalled())
    const sql = h.runQuery.mock.calls.at(-1)?.[0].sql.toLowerCase() ?? ''
    expect(sql).toContain('revenue as x')
    expect(sql).toContain('profit as y')
    expect(sql).not.toContain('group by')
  })

  it('automatically runs the chart query for a valid chart', async () => {
    wrap(<ChartsPage />)

    await screen.findByLabelText('Chart type')
    expect(h.runQuery).not.toHaveBeenCalled()

    await waitFor(() => expect(h.runQuery).toHaveBeenCalledTimes(1))
    expect(h.runQuery.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        max_rows: 5000,
        sql: expect.stringContaining('least(12, max_v - min_v + 1)'),
      }),
    )
    expect(h.runQuery.mock.calls[0]?.[0].sql.toLowerCase()).toContain('cast(min(revenue) as bigint) as min_v')
  })

  it('creates and explicitly updates a saved chart', async () => {
    const user = userEvent.setup()
    wrap(<ChartsPage />)
    await screen.findByLabelText('Chart type')

    await user.click(screen.getByRole('button', { name: /^Save$/ }))
    const dialog = screen.getByRole('dialog')
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Revenue distribution')
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(h.createSavedChart).toHaveBeenCalledWith(expect.objectContaining({
      dataset_id: 'ds_001', name: 'Revenue distribution',
    })))
    expect(screen.getByLabelText('Saved chart')).toHaveValue('chart_1')

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Updated title')
    await user.click(screen.getByRole('button', { name: /Save changes/i }))
    await waitFor(() => expect(h.patchSavedChart).toHaveBeenCalledWith('chart_1', expect.objectContaining({
      spec: expect.objectContaining({ title: 'Updated title' }),
    })))
  })

  it('loads and normalizes a legacy saved chart deep link', async () => {
    h.listSavedCharts.mockResolvedValue([{
      chart_id: 'legacy', dataset_id: 'ds_001', name: 'Legacy', description: null,
      spec: { version: 2, datasetId: 'ds_001', chartType: 'histogram', valueColumn: 'revenue', title: 'Legacy title' },
      created_at: 'then', updated_at: 'now',
    }])
    wrap(<ChartsPage />, '/charts?ds=ds_001&chart=legacy')

    expect(await screen.findByDisplayValue('Legacy title')).toBeInTheDocument()
    expect(screen.getByLabelText('Saved chart')).toHaveValue('legacy')
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument()
  })

  it('keeps the chart workspace usable when saved charts cannot be loaded', async () => {
    h.listSavedCharts.mockRejectedValue(new Error('Saved charts are unavailable'))
    wrap(<ChartsPage />, '/charts?ds=ds_001&chart=chart_1')

    expect(await screen.findByText('Saved charts are unavailable')).toBeInTheDocument()
    expect(screen.getByLabelText('Chart type')).toHaveValue('histogram')
  })

  it('shows a truncation warning from the query result', async () => {
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'bin_index', type: null }, { name: 'lower_bound', type: null }, { name: 'upper_bound', type: null }, { name: 'count', type: null }],
      rows: [{ bin_index: 0, lower_bound: 0, upper_bound: 10, count: 10 }],
      row_count: 5000,
      truncated: true,
      error: null,
    })

    wrap(<ChartsPage />)
    await screen.findByLabelText('Chart type')

    expect(await screen.findByText(/Truncated at 5,000 rows/i)).toBeInTheDocument()
  })

  it('auto-runs after SQL-affecting data settings change', async () => {
    const user = userEvent.setup()
    wrap(<ChartsPage />)

    await screen.findByLabelText('Chart type')
    await waitFor(() => expect(h.runQuery).toHaveBeenCalledTimes(1))

    await user.clear(screen.getByLabelText('Bins'))
    await user.type(screen.getByLabelText('Bins'), '20')

    await waitFor(() => expect(h.runQuery).toHaveBeenCalledTimes(2))
    expect(h.runQuery.mock.calls[1]?.[0].sql).toContain('least(20, max_v - min_v + 1)')
  })

  it('does not rerun SQL for display-only changes', async () => {
    const user = userEvent.setup()
    wrap(<ChartsPage />)

    await screen.findByLabelText('Chart type')
    await waitFor(() => expect(h.runQuery).toHaveBeenCalledTimes(1))

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Custom title')
    await new Promise((resolve) => window.setTimeout(resolve, 550))

    expect(h.runQuery).toHaveBeenCalledTimes(1)
  })

  it('exercises scale, filter, split, and export controls with live query results', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'bin_index', type: null }, { name: 'lower_bound', type: null }, { name: 'upper_bound', type: null }, { name: 'count', type: null }],
      rows: [{ bin_index: 0, lower_bound: 0, upper_bound: 10, count: 10 }],
      row_count: 1,
      truncated: false,
      error: null,
    })

    wrap(<ChartsPage />)
    await screen.findByLabelText('Chart type')
    await waitFor(() => expect(screen.getByTestId('charts-preview')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Add filter/i }))
    const operatorSelect = screen
      .getAllByRole('combobox')
      .find((el) => Array.from((el as HTMLSelectElement).options).some((option) => option.value === 'is_null'))
    expect(operatorSelect).toBeTruthy()
    await user.selectOptions(operatorSelect!, 'is_null')
    expect(screen.getAllByPlaceholderText('Value').some((input) => (input as HTMLInputElement).disabled)).toBe(true)
    await user.click(screen.getAllByRole('button', { name: /Remove filter/i })[1]!)

    await user.selectOptions(screen.getByLabelText('Split by'), 'region')
    expect(await screen.findByText(/region has about 30 values/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Chart type'), 'line')
    await user.selectOptions(screen.getByLabelText('Y scale'), 'auto')
    await user.selectOptions(screen.getByLabelText('Y scale'), 'manual')
    await user.clear(screen.getByLabelText('Y min'))
    await user.type(screen.getByLabelText('Y min'), '1')
    await user.clear(screen.getByLabelText('Y max'))
    await user.type(screen.getByLabelText('Y max'), '99')
    await user.click(screen.getByRole('button', { name: /Add reference line/i }))
    await user.click(screen.getAllByRole('button', { name: /Remove reference line/i })[1]!)

    await user.click(screen.getByRole('button', { name: /PNG/i }))
    await user.click(screen.getByRole('button', { name: /CSV/i }))
    await user.click(screen.getByRole('button', { name: /Spec/i }))
    await user.click(screen.getByRole('button', { name: /Zoom/i }))
    expect(click).toHaveBeenCalledTimes(3)

    await user.click(screen.getByRole('button', { name: /Reset/i }))
    expect(screen.getByDisplayValue('revenue distribution')).toBeInTheDocument()
  })
})

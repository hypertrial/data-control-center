import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
  runQuery: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listDatasets: h.listDatasets,
      fetchDatasetProfile: h.fetchDatasetProfile,
      runQuery: h.runQuery,
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
    h.fetchDatasetProfile.mockResolvedValue(chartableProfile())
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'bin_index', type: null }, { name: 'lower_bound', type: null }, { name: 'upper_bound', type: null }, { name: 'count', type: null }],
      rows: [{ bin_index: 0, lower_bound: 0, upper_bound: 10, count: 4 }],
      row_count: 1,
      truncated: false,
      error: null,
    })
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
    h.fetchDatasetProfile.mockResolvedValue(
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
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument()
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
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
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
    expect(write).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Reset/i }))
    expect(screen.getByDisplayValue('revenue distribution')).toBeInTheDocument()
  })
})

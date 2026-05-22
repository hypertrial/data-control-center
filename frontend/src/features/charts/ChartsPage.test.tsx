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
      runQuery: h.runQuery,
      listSavedCharts: h.listSavedCharts,
      createSavedChart: h.createSavedChart,
      patchSavedChart: h.patchSavedChart,
      deleteSavedChart: h.deleteSavedChart,
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
    h.listSavedCharts.mockResolvedValue([])
    h.createSavedChart.mockResolvedValue({
      chart_id: 'ch_1',
      dataset_id: 'ds_001',
      name: 'Chart',
      spec_json: '{}',
      created_at: 'c',
      updated_at: 'u',
    })
    h.patchSavedChart.mockResolvedValue({
      chart_id: 'ch_1',
      dataset_id: 'ds_001',
      name: 'Chart',
      spec_json: '{}',
      created_at: 'c',
      updated_at: 'u',
    })
    h.deleteSavedChart.mockResolvedValue(undefined)
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'x', type: null }, { name: 'revenue', type: null }, { name: 'profit', type: null }],
      rows: [{ x: '2026-01-01', revenue: 10, profit: 4 }],
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
    expect(screen.getByRole('button', { name: /Run chart/i })).toBeDisabled()
  })

  it('preselects temporal and numeric defaults from the profile', async () => {
    wrap(<ChartsPage />)

    await waitFor(() => expect(screen.getByLabelText('X axis')).toHaveValue('order_date'))
    expect(screen.getByLabelText('revenue')).toBeChecked()
    expect(screen.getByLabelText('profit')).toBeChecked()
    expect(screen.getByDisplayValue('Orders trends')).toBeInTheDocument()
  })

  it('runs the chart query only after clicking Run chart', async () => {
    const user = userEvent.setup()
    wrap(<ChartsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Run chart/i })).toBeEnabled())
    expect(h.runQuery).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Run chart/i }))

    await waitFor(() => expect(h.runQuery).toHaveBeenCalledTimes(1))
    expect(h.runQuery.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        max_rows: 5000,
        sql: expect.stringContaining('avg(revenue) as revenue'),
      }),
    )
  })

  it('shows a truncation warning from the query result', async () => {
    const user = userEvent.setup()
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'x', type: null }, { name: 'revenue', type: null }],
      rows: [{ x: '2026-01-01', revenue: 10 }],
      row_count: 5000,
      truncated: true,
      error: null,
    })

    wrap(<ChartsPage />)
    await user.click(await screen.findByRole('button', { name: /Run chart/i }))

    expect(await screen.findByText(/Truncated at 5,000 rows/i)).toBeInTheDocument()
  })

  it('auto-runs after data settings change once the chart has run', async () => {
    const user = userEvent.setup()
    wrap(<ChartsPage />)

    await user.click(await screen.findByRole('button', { name: /Run chart/i }))
    await waitFor(() => expect(h.runQuery).toHaveBeenCalledTimes(1))

    await user.selectOptions(screen.getByLabelText('Aggregation'), 'sum')

    await waitFor(() => expect(h.runQuery).toHaveBeenCalledTimes(2))
    expect(h.runQuery.mock.calls[1]?.[0].sql).toContain('sum(revenue) as revenue')
  })

  it('saves the current chart spec', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'prompt').mockReturnValue('My chart')
    wrap(<ChartsPage />)

    await user.click(await screen.findByRole('button', { name: /^Save$/i }))

    await waitFor(() => expect(h.createSavedChart).toHaveBeenCalled())
    expect(h.createSavedChart.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ dataset_id: 'ds_001', name: 'My chart' }),
    )
  })

  it('loads saved charts and exercises management, scale, filter, split, and export controls', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('Renamed chart')
      .mockReturnValueOnce('Copied chart')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    h.listSavedCharts.mockResolvedValue([
      {
        chart_id: 'ch_1',
        dataset_id: 'ds_001',
        name: 'Saved ratings',
        spec_json: JSON.stringify({
          version: 2,
          chartType: 'line',
          xColumn: 'order_date',
          yColumns: ['revenue'],
          aggregation: 'avg',
          bucket: 'month',
          splitBy: 'region',
          filters: [{ id: 'f_saved', column: 'region', operator: 'eq', value: 'East' }],
          yAxisScale: 'manual',
          yAxisMin: '0',
          yAxisMax: '100',
          referenceLines: [{ id: 'r_saved', label: 'Target', value: '50' }],
          title: 'Saved ratings',
        }),
        created_at: 'c',
        updated_at: 'u',
      },
    ])
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'x', type: null }, { name: 'split', type: null }, { name: 'value', type: null }],
      rows: [{ x: '2026-01-01', split: 'East', value: 10 }],
      row_count: 1,
      truncated: false,
      error: null,
    })

    wrap(<ChartsPage />)
    await screen.findByText('Saved Charts')
    await screen.findByRole('option', { name: 'Saved ratings' })

    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'ch_1')
    expect(await screen.findAllByDisplayValue('Saved ratings')).toHaveLength(2)
    expect(await screen.findByText(/region has about 30 values/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(h.patchSavedChart).toHaveBeenCalled())
    expect(h.patchSavedChart.mock.calls[0]?.[0]).toBe('ch_1')
    expect(h.patchSavedChart.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ spec_json: expect.any(String) }))

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(h.patchSavedChart.mock.calls[1]?.[1]).toEqual({ name: 'Renamed chart' })

    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(h.createSavedChart.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ name: 'Copied chart' }))

    await user.click(screen.getByRole('button', { name: /Delete/i }))
    expect(h.deleteSavedChart).toHaveBeenCalledWith('ch_1', expect.anything())

    await user.click(screen.getByRole('button', { name: /Add filter/i }))
    const operatorSelect = screen
      .getAllByRole('combobox')
      .find((el) => Array.from((el as HTMLSelectElement).options).some((option) => option.value === 'is_null'))
    expect(operatorSelect).toBeTruthy()
    await user.selectOptions(operatorSelect!, 'is_null')
    expect(screen.getAllByPlaceholderText('Value').some((input) => (input as HTMLInputElement).disabled)).toBe(true)
    await user.click(screen.getAllByRole('button', { name: /Remove filter/i })[1]!)

    await user.selectOptions(screen.getByLabelText('Y scale'), 'auto')
    await user.selectOptions(screen.getByLabelText('Y scale'), 'manual')
    await user.clear(screen.getByLabelText('Y min'))
    await user.type(screen.getByLabelText('Y min'), '1')
    await user.clear(screen.getByLabelText('Y max'))
    await user.type(screen.getByLabelText('Y max'), '99')
    await user.click(screen.getByRole('button', { name: /Add reference line/i }))
    await user.click(screen.getAllByRole('button', { name: /Remove reference line/i })[1]!)

    await user.click(screen.getByRole('button', { name: /Run chart/i }))
    await waitFor(() => expect(screen.getByTestId('charts-preview')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /PNG/i }))
    await user.click(screen.getByRole('button', { name: /CSV/i }))
    await user.click(screen.getByRole('button', { name: /Spec/i }))
    await user.click(screen.getByRole('button', { name: /Zoom/i }))
    expect(write).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Reset/i }))
    expect(screen.getByDisplayValue('Unsaved chart')).toBeInTheDocument()
  })
})

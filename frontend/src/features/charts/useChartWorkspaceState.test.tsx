import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({
  listSavedCharts: vi.fn(),
  runQuery: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: {
    listSavedCharts: h.listSavedCharts,
    runQuery: h.runQuery,
    createSavedChart: vi.fn(),
    patchSavedChart: vi.fn(),
    deleteSavedChart: vi.fn(),
  },
}))

vi.mock('@/hooks/useDisposableEChart', () => ({
  useDisposableEChart: vi.fn(),
}))

vi.mock('@/hooks/useOpenInSql', () => ({
  useOpenInSql: () => vi.fn(),
}))

const chartableProfile = () =>
  mkProfile({
    dataset_id: 'ds_1',
    primary_temporal_column: { name: 'order_date', kind: 'continuous_datetime', confidence: 'high' },
    temporal_columns: [{ name: 'order_date', kind: 'continuous_datetime', confidence: 'high' }],
    measure_candidates: [{ name: 'revenue', score: 0.9, confidence: 'high' }],
    column_profiles: [
      mkColumn({ name: 'order_date', semantic_type: 'datetime', null_pct: 0 }),
      mkColumn({ name: 'revenue', semantic_type: 'numeric', null_pct: 0 }),
    ],
  })

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const profile = chartableProfile()
  const view = renderHook(() => useChartWorkspaceState('ds_1', profile, 'orders'), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
  return { ...view, qc }
}

describe('useChartWorkspaceState', () => {
  beforeEach(() => {
    h.listSavedCharts.mockResolvedValue([])
    h.runQuery.mockResolvedValue({ columns: [], rows: [], row_count: 0, truncated: false, error: null })
  })

  it('auto-runs when spec changes after first run', async () => {
    const { result } = renderWorkspace()

    await act(async () => {
      result.current.executeSql('SELECT 1 AS x')
    })
    expect(h.runQuery).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    act(() => {
      result.current.patchSpec({ aggregation: 'sum' })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })

    expect(h.runQuery).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('loadSaved resets run state and mutation', () => {
    h.listSavedCharts.mockResolvedValue([
      {
        chart_id: 'c1',
        dataset_id: 'ds_1',
        name: 'Saved',
        spec_json: JSON.stringify({
          datasetId: 'ds_1',
          title: 'Saved chart',
          xColumn: 'order_date',
          yColumns: ['revenue'],
        }),
        created_at: '',
        updated_at: '',
      },
    ])

    const { result, qc } = renderWorkspace()
    qc.setQueryData(['saved-charts', 'ds_1'], [
      {
        chart_id: 'c1',
        dataset_id: 'ds_1',
        name: 'Saved',
        spec_json: JSON.stringify({
          datasetId: 'ds_1',
          title: 'Saved chart',
          xColumn: 'order_date',
          yColumns: ['revenue'],
        }),
        created_at: '',
        updated_at: '',
      },
    ])

    act(() => {
      result.current.executeSql('SELECT 1')
    })
    expect(result.current.hasRun).toBe(true)

    act(() => {
      result.current.loadSaved('c1')
    })

    expect(result.current.hasRun).toBe(false)
    expect(result.current.selectedSavedChartId).toBe('c1')
  })

  it('resetWorkspace clears saved selection and run state', () => {
    const { result } = renderWorkspace()

    act(() => {
      result.current.execute()
      result.current.resetWorkspace()
    })

    expect(result.current.hasRun).toBe(false)
    expect(result.current.selectedSavedChartId).toBe('')
  })
})

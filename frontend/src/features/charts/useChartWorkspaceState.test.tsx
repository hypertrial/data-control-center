import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartWorkspaceState } from '@/features/charts/useChartWorkspaceState'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({
  runQuery: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: {
    runQuery: h.runQuery,
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
    vi.clearAllMocks()
    h.runQuery.mockResolvedValue({ columns: [], rows: [], row_count: 0, truncated: false, error: null })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-runs the initial valid chart after a debounce', async () => {
    const { result } = renderWorkspace()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })

    expect(h.runQuery).toHaveBeenCalledTimes(1)
    expect(h.runQuery.mock.calls[0]?.[0].sql).toContain('least(12, max_v - min_v + 1)')
    expect(result.current.settingsChanged).toBe(false)
  })

  it('auto-runs when generated SQL changes', async () => {
    const { result } = renderWorkspace()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(h.runQuery).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.patchSpec({ binCount: 20 })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })

    expect(h.runQuery).toHaveBeenCalledTimes(2)
    expect(h.runQuery.mock.calls[1]?.[0].sql).toContain('least(20, max_v - min_v + 1)')
  })

  it('does not auto-run invalid specs', async () => {
    const { result } = renderWorkspace()

    act(() => {
      result.current.patchSpec({ valueColumn: '' })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })

    expect(h.runQuery).not.toHaveBeenCalled()
  })

  it('resetWorkspace clears query state and lets the default chart auto-run again', async () => {
    const { result } = renderWorkspace()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(h.runQuery).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.patchSpec({ binCount: 20 })
      result.current.resetWorkspace()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })

    expect(h.runQuery).toHaveBeenCalledTimes(2)
    expect(h.runQuery.mock.calls[1]?.[0].sql).toContain('least(12, max_v - min_v + 1)')
  })

  it('auto-runs when bar topN changes', async () => {
    const profile = mkProfile({
      primary_temporal_column: { name: 'order_date', kind: 'continuous_datetime', confidence: 'high' },
      temporal_columns: [{ name: 'order_date', kind: 'continuous_datetime', confidence: 'high' }],
      measure_candidates: [{ name: 'revenue', score: 0.9, confidence: 'high' }],
      column_profiles: [
        mkColumn({ name: 'order_date', semantic_type: 'datetime', null_pct: 0 }),
        mkColumn({ name: 'revenue', semantic_type: 'numeric', null_pct: 0 }),
        mkColumn({ name: 'region', semantic_type: 'categorical', cardinality: 4 }),
      ],
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const view = renderHook(() => useChartWorkspaceState('ds_1', profile, 'orders'), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })

    act(() => {
      view.result.current.patchSpec({
        chartType: 'bar',
        xColumn: 'region',
        yColumns: ['revenue'],
        aggregation: 'sum',
        topN: 25,
        bucket: 'none',
        xColumnBucketable: false,
        xColumnTemporalKind: null,
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(h.runQuery).toHaveBeenCalledTimes(1)
    expect(h.runQuery.mock.calls[0]?.[0].sql.toLowerCase()).toMatch(/limit\s+25/)

    act(() => {
      view.result.current.patchSpec({ topN: 10 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(h.runQuery).toHaveBeenCalledTimes(2)
    expect(h.runQuery.mock.calls[1]?.[0].sql.toLowerCase()).toMatch(/limit\s+10/)
  })

  it('does not rerun SQL for scatter display-only title changes', async () => {
    const profile = mkProfile({
      measure_candidates: [
        { name: 'height', score: 0.9, confidence: 'high' },
        { name: 'weight', score: 0.8, confidence: 'high' },
      ],
      column_profiles: [
        mkColumn({ name: 'height', semantic_type: 'numeric' }),
        mkColumn({ name: 'weight', semantic_type: 'numeric' }),
      ],
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const view = renderHook(() => useChartWorkspaceState('ds_1', profile, 'orders'), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(h.runQuery).toHaveBeenCalledTimes(1)

    act(() => {
      view.result.current.patchSpec({ title: 'Custom scatter title' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(h.runQuery).toHaveBeenCalledTimes(1)
  })

  it('retries the current generated SQL on demand', async () => {
    const { result } = renderWorkspace()

    await act(async () => {
      result.current.execute()
      result.current.execute()
    })

    expect(h.runQuery).toHaveBeenCalledTimes(2)
    expect(h.runQuery.mock.calls[1]?.[0].sql).toBe(h.runQuery.mock.calls[0]?.[0].sql)
  })
})

import * as React from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UiUrlSync } from '@/hooks/UiUrlSync'
import { useUiStore } from '@/store/uiStore'

const h = vi.hoisted(() => ({
  listDatasets: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: { ...mod.api, listDatasets: h.listDatasets },
  }
})

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function currentParams() {
  return new URLSearchParams(screen.getByTestId('location').textContent?.split('?')[1] ?? '')
}

function wrap(route: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <UiUrlSync />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const datasets = [
  {
    dataset_id: 'ds_001',
    name: 'alpha.csv',
    view_name: 'alpha',
    source_path: '/alpha.csv',
    format: 'csv',
    row_count: 10,
    column_count: 3,
    file_size_bytes: 50,
  },
  {
    dataset_id: 'ds_002',
    name: 'beta.csv',
    view_name: 'beta',
    source_path: '/beta.csv',
    format: 'csv',
    row_count: 10,
    column_count: 3,
    file_size_bytes: 50,
  },
]

describe('UiUrlSync', () => {
  beforeEach(() => {
    h.listDatasets.mockReset()
    h.listDatasets.mockResolvedValue(datasets)
    useUiStore.setState({
      activeDatasetId: null,
      columnSearch: '',
      semanticFilter: 'all',
      qualitySeverityFilter: 'all',
      columnQualityFilter: 'all',
      selectedColumn: null,
      columnDrawerOpen: false,
    })
  })

  it('auto-selects the first dataset when URL omits ds', async () => {
    wrap('/overview')
    await waitFor(() => expect(useUiStore.getState().activeDatasetId).toBe('ds_001'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/overview?ds=ds_001'))
  })

  it('hydrates store filters and drawer state from URL params', async () => {
    useUiStore.setState({ activeDatasetId: 'ds_002' })
    wrap('/columns?ds=ds_002&q=revenue&sem=numeric&sev=warning&cq=critical&col=amount')
    await waitFor(() =>
      expect(useUiStore.getState()).toMatchObject({
        activeDatasetId: 'ds_002',
        columnSearch: 'revenue',
        semanticFilter: 'numeric',
        qualitySeverityFilter: 'warning',
        columnQualityFilter: 'critical_only',
        selectedColumn: 'amount',
        columnDrawerOpen: true,
      }),
    )
  })

  it('clears active dataset when URL points at a missing dataset', async () => {
    useUiStore.setState({ activeDatasetId: 'missing' })
    wrap('/columns?ds=missing')
    await waitFor(() => expect(useUiStore.getState().activeDatasetId).toBeNull())
  })

  it('writes store state back to the URL and removes default filters', async () => {
    wrap('/columns?ds=ds_001&q=old&sem=text&sev=critical&cq=flags&col=old_col')
    await waitFor(() => expect(useUiStore.getState().activeDatasetId).toBe('ds_001'))

    useUiStore.setState({
      activeDatasetId: 'ds_002',
      columnSearch: 'profit',
      semanticFilter: 'datetime',
      qualitySeverityFilter: 'info',
      columnQualityFilter: 'critical_only',
      selectedColumn: 'event_date',
      columnDrawerOpen: true,
    })

    await waitFor(() =>
      expect(Object.fromEntries(currentParams().entries())).toEqual({
        ds: 'ds_002',
        q: 'profit',
        sem: 'datetime',
        sev: 'info',
        cq: 'critical',
        col: 'event_date',
      }),
    )

    useUiStore.setState({
      activeDatasetId: null,
      columnSearch: '',
      semanticFilter: 'all',
      qualitySeverityFilter: 'all',
      columnQualityFilter: 'all',
      selectedColumn: null,
      columnDrawerOpen: false,
    })

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/columns'))
  })
})

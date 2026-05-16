import { MemoryRouter } from 'react-router-dom'
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ColumnsPage } from '@/features/columns/ColumnsPage'
import { useUiStore } from '@/store/uiStore'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

const h = vi.hoisted(() => ({ getProfile: vi.fn(), listDatasets: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, getProfile: h.getProfile, listDatasets: h.listDatasets } }
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

describe('ColumnsPage', () => {
  beforeEach(() => {
    useUiStore.setState({ columnsTableHidden: {} })
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
    h.getProfile.mockResolvedValue(
      mkProfile({
        column_profiles: [
          mkColumn({ name: 'alpha', semantic_type: 'numeric' }),
          mkColumn({ name: 'beta', semantic_type: 'text' }),
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
    h.getProfile.mockImplementation(() => new Promise(() => {}))
    wrap(<ColumnsPage />)
    expect(screen.getByRole('status', { name: /loading table/i })).toBeInTheDocument()
  })

  it('error', async () => {
    h.getProfile.mockRejectedValue(new Error('e1'))
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByText('e1')).toBeInTheDocument())
  })

  it('truncates long column names but keeps full title', async () => {
    const long = 'world_cup_squad_tournament_year_extra_suffix_for_test'
    h.getProfile.mockResolvedValue(
      mkProfile({
        column_profiles: [mkColumn({ name: long, semantic_type: 'text' })],
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByTitle(long)).toBeInTheDocument())
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
    await user.click(screen.getByRole('button', { name: 'Text' }))
    expect(screen.queryByText('alpha')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'All types' }))
    const grid = screen.getByRole('table')
    const sortBtn = within(grid).getByRole('button', { name: /^Column/ })
    await user.click(sortBtn)

    const row = screen.getByText('beta').closest('tr')
    expect(row).toBeTruthy()
    await user.click(row!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument())
  })
})

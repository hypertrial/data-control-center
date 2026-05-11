import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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

const h = vi.hoisted(() => ({ getProfile: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, getProfile: h.getProfile } }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ColumnsPage', () => {
  beforeEach(() => {
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
    expect(screen.getAllByText(/Loading columns/).length).toBeGreaterThan(0)
  })

  it('error', async () => {
    h.getProfile.mockRejectedValue(new Error('e1'))
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getByText('e1')).toBeInTheDocument())
  })

  it('filters sorts and opens drawer', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ activeDatasetId: 'ds_1', columnSearch: '', semanticFilter: 'all' })
    wrap(<ColumnsPage />)
    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const search = screen.getAllByRole('textbox')[0]!
    await user.type(search, 'alp')
    expect(screen.queryByText('beta')).toBeNull()

    await user.clear(search)
    const sem = screen.getByRole('combobox')
    await user.selectOptions(sem, 'text')
    expect(screen.queryByText('alpha')).toBeNull()

    await user.selectOptions(sem, 'all')
    const sortBtn = screen.getByRole('button', { name: /Column/ })
    await user.click(sortBtn)

    const row = screen.getByText('beta').closest('tr')
    expect(row).toBeTruthy()
    await user.click(row!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument())
  })
})

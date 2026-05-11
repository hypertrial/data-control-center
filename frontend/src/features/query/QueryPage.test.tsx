import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryPage } from '@/features/query/QueryPage'
import { useUiStore } from '@/store/uiStore'

const h = vi.hoisted(() => ({ runQuery: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, runQuery: h.runQuery } }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('QueryPage', () => {
  beforeEach(() => {
    h.runQuery.mockReset()
  })

  it('runs query with view hint and shows results', async () => {
    const user = userEvent.setup()
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'x', type: 'int' }],
      rows: [{ x: 1 }, { x: { y: 2 } }],
      row_count: 2,
      truncated: true,
      error: null,
    })
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<QueryPage />)
    expect(screen.getAllByText(/v_ds_001/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(screen.getByText(/\(truncated\)/)).toBeInTheDocument())
    expect(screen.getByText('{"y":2}')).toBeInTheDocument()
  })

  it('no active dataset view hint fallback', () => {
    useUiStore.setState({ activeDatasetId: null })
    wrap(<QueryPage />)
    expect(screen.getAllByText(/v_ds_001/).length).toBeGreaterThan(0)
  })

  it('shows sql error and mutation error', async () => {
    const user = userEvent.setup()
    h.runQuery
      .mockResolvedValueOnce({
        columns: [],
        rows: [],
        row_count: 0,
        error: 'bad sql',
      })
      .mockRejectedValueOnce(new Error('network'))
    wrap(<QueryPage />)
    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(screen.getByText('bad sql')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(screen.getByText('network')).toBeInTheDocument())
  })

  it('pending', async () => {
    const user = userEvent.setup()
    h.runQuery.mockImplementation(() => new Promise(() => {}))
    wrap(<QueryPage />)
    await user.click(screen.getByRole('button', { name: 'Run query' }))
    expect(screen.getByText(/Running/)).toBeInTheDocument()
  })
})

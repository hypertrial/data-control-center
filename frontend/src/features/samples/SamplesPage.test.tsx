import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SamplesPage } from '@/features/samples/SamplesPage'
import { useUiStore } from '@/store/uiStore'
import { mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({ getSample: vi.fn(), getProfile: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: { ...mod.api, getSample: h.getSample, getProfile: h.getProfile, fetchDatasetProfile: h.getProfile },
  }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('SamplesPage', () => {
  beforeEach(() => {
    h.getSample.mockReset()
    h.getProfile.mockResolvedValue(mkProfile({ column_profiles: [] }))
  })

  it('no dataset', () => {
    wrap(<SamplesPage />)
    expect(screen.getByText(/Select a dataset/)).toBeInTheDocument()
  })

  it('loading and error', async () => {
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    h.getSample.mockImplementation(() => new Promise(() => {}))
    const { unmount } = wrap(<SamplesPage />)
    expect(screen.getByRole('status', { name: /loading table/i })).toBeInTheDocument()
    unmount()

    h.getSample.mockRejectedValue(new Error('se'))
    wrap(<SamplesPage />)
    await waitFor(() => expect(screen.getByText('se')).toBeInTheDocument())
  })

  it('table pagination and object cell', async () => {
    const user = userEvent.setup()
    h.getSample
      .mockResolvedValueOnce({
        page: 1,
        page_size: 100,
        row_count: 100,
        total_rows: 150,
        columns: ['a', 'b'],
        rows: [{ a: 1, b: { x: 1 } }],
      })
      .mockResolvedValueOnce({
        page: 2,
        page_size: 100,
        row_count: 50,
        total_rows: 150,
        columns: ['a', 'b'],
        rows: [],
      })
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<SamplesPage />)
    await waitFor(() => expect(screen.getByText(/\{"x":1\}/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText(/101-150/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled()
  })
})

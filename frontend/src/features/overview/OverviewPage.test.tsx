import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { useUiStore } from '@/store/uiStore'
import { mkProfile } from '@/test/profileFixtures'

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

describe('OverviewPage', () => {
  it('prompts when no dataset', () => {
    wrap(<OverviewPage />)
    expect(screen.getByText(/Select or register a dataset/i)).toBeInTheDocument()
  })

  it('loads profile when active', async () => {
    h.getProfile.mockResolvedValue(mkProfile({ file_size_bytes: 100, narrative: '**Hello** world' }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Demo' })).toBeInTheDocument())
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText(/100 B/)).toBeInTheDocument()
  })

  it('formatBytes scales', async () => {
    h.getProfile.mockResolvedValue(
      mkProfile({
        file_size_bytes: 10_000,
        quality_score: null,
        likely_grain: null,
        primary_date_column: null,
      }),
    )
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/9\.8 KB/)).toBeInTheDocument())
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows loading', () => {
    h.getProfile.mockImplementation(() => new Promise(() => {}))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    expect(screen.getByText(/Loading profile/)).toBeInTheDocument()
  })

  it('formatBytes MB', async () => {
    h.getProfile.mockResolvedValue(mkProfile({ file_size_bytes: 3 * 1024 * 1024 }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/3\.0 MB/)).toBeInTheDocument())
  })

  it('formatBytes GB', async () => {
    h.getProfile.mockResolvedValue(mkProfile({ file_size_bytes: 2 * 1024 ** 3 }))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText(/2\.0 GB/)).toBeInTheDocument())
  })

  it('shows error state', async () => {
    h.getProfile.mockRejectedValue(new Error('boom'))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<OverviewPage />)
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})

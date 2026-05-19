import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QualityPage } from '@/features/quality/QualityPage'
import { useUiStore } from '@/store/uiStore'
import { mkIssue, mkProfile } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({ getQuality: vi.fn(), getProfile: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: { ...mod.api, getQuality: h.getQuality, getProfile: h.getProfile, fetchDatasetProfile: h.getProfile },
  }
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

describe('QualityPage', () => {
  it('no dataset', () => {
    wrap(<QualityPage />)
    expect(screen.getByText(/Select a dataset/)).toBeInTheDocument()
  })

  it('loading', () => {
    h.getQuality.mockImplementation(() => new Promise(() => {}))
    h.getProfile.mockImplementation(() => new Promise(() => {}))
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<QualityPage />)
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0)
  })

  it('error', async () => {
    h.getQuality.mockRejectedValue(new Error('qe'))
    h.getProfile.mockResolvedValue(mkProfile())
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<QualityPage />)
    await waitFor(() => expect(screen.getByText('qe')).toBeInTheDocument())
  })

  it('lists issues and filters by severity', async () => {
    const user = userEvent.setup()
    h.getQuality.mockResolvedValue([
      mkIssue({ severity: 'critical', id: 'c1', title: 'Critical thing' }),
      mkIssue({
        severity: 'warning',
        id: 'w1',
        title: 'Warn thing',
        affected_columns: ['a'],
        examples: [42],
        suggested_sql: 'SELECT 1',
      }),
      mkIssue({ severity: 'info', id: 'i1', title: 'Info thing' }),
    ])
    h.getProfile.mockResolvedValue(mkProfile())
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<QualityPage />)
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument())
    expect(screen.getByText('Info thing')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Warning \(1\)/ }))
    expect(screen.queryByText('Critical thing')).toBeNull()
    expect(screen.getByText('Warn thing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open in SQL/i })).toBeInTheDocument()
  })
})

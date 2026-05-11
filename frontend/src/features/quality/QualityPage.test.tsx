import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QualityPage } from '@/features/quality/QualityPage'
import { useUiStore } from '@/store/uiStore'
import { mkIssue } from '@/test/profileFixtures'

const h = vi.hoisted(() => ({ getQuality: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, getQuality: h.getQuality } }
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('QualityPage', () => {
  it('no dataset', () => {
    wrap(<QualityPage />)
    expect(screen.getByText(/Select a dataset/)).toBeInTheDocument()
  })

  it('loading', () => {
    h.getQuality.mockImplementation(() => new Promise(() => {}))
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<QualityPage />)
    expect(screen.getByText(/Loading issues/)).toBeInTheDocument()
  })

  it('error', async () => {
    h.getQuality.mockRejectedValue(new Error('qe'))
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
    useUiStore.setState({ activeDatasetId: 'ds_1' })
    wrap(<QualityPage />)
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument())
    expect(screen.getByText('Info thing')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox'), 'warning')
    expect(screen.queryByText('Critical thing')).toBeNull()
    expect(screen.getByText('Warn thing')).toBeInTheDocument()
    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
  })
})

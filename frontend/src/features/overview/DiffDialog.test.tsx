import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { ProfileDiffDialog } from '@/features/overview/DiffDialog'

vi.mock('@/api/client', () => ({
  api: {
    getProfileDiff: vi.fn(),
  },
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ProfileDiffDialog', () => {
  it('renders diff content', async () => {
    vi.mocked(api.getProfileDiff).mockResolvedValue({
      history_id_a: 'old',
      history_id_b: 'new',
      created_at_a: 'before',
      created_at_b: 'after',
      new_columns: ['added'],
      removed_columns: ['removed'],
      null_pct_changes: [{ column: 'x', before: 1, after: 3, delta: 2 }],
      quality_score_delta: 1.5,
    })

    wrap(<ProfileDiffDialog datasetId="ds_1" open onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByText('Quality score Δ')).toBeInTheDocument())
    expect(screen.getByText('added')).toBeInTheDocument()
    expect(screen.getByText('removed')).toBeInTheDocument()
    expect(screen.getByText('+2.00')).toBeInTheDocument()
  })

  it('renders loading and error states', async () => {
    vi.mocked(api.getProfileDiff).mockImplementationOnce(() => new Promise(() => {}))
    const pending = wrap(<ProfileDiffDialog datasetId="ds_1" open onOpenChange={() => {}} />)
    expect(screen.getByText(/Loading diff/)).toBeInTheDocument()
    pending.unmount()

    vi.mocked(api.getProfileDiff).mockRejectedValueOnce(new Error('no snapshots'))
    wrap(<ProfileDiffDialog datasetId="ds_1" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('no snapshots')).toBeInTheDocument())
  })
})

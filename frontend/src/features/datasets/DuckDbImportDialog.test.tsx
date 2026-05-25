import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { DuckDbImportDialog } from '@/features/datasets/DuckDbImportDialog'

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/api/client', () => ({
  api: {
    inspectDuckDb: vi.fn(),
    importDuckDbRelations: vi.fn(),
    getJob: vi.fn(),
  },
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('DuckDbImportDialog', () => {
  it('auto-inspects and imports selected relations', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([
      { schema: 'main', name: 'orders', type: 'table', column_count: 2, row_count: 2 },
    ])
    vi.mocked(api.importDuckDbRelations).mockResolvedValue({ job_id: 'job1', status: 'queued' })
    vi.mocked(api.getJob).mockResolvedValue({
      job_id: 'job1',
      kind: 'duckdb_import',
      dataset_id: null,
      status: 'completed',
      progress: 1,
      error_message: null,
      cancel_requested: false,
      created_at: 'now',
      updated_at: 'now',
      finished_at: 'now',
      result: { datasets: [{ dataset_id: 'ds_9', name: 'orders', view_name: 'orders', source_path: '/x', format: 'parquet', row_count: 1, column_count: 1, file_size_bytes: 1 }] },
    })
    const onImported = vi.fn()
    const onClose = vi.fn()

    wrap(
      <DuckDbImportDialog
        session={{ uploadId: 'up_1', filename: 'source.duckdb' }}
        onClose={onClose}
        onImported={onImported}
      />,
    )

    await waitFor(() => expect(api.inspectDuckDb).toHaveBeenCalledWith('up_1'))
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Select main.orders'))
    await user.click(screen.getByRole('button', { name: /Import 1/ }))

    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })
})

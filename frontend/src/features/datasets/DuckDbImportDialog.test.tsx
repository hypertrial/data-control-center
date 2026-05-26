import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import type { DuckDbRelationSummary } from '@/api/types'
import { DuckDbImportDialog } from '@/features/datasets/DuckDbImportDialog'

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      count > 0 ? [{ index: 0, start: 12, end: 64 }] : [],
    getTotalSize: () => count * 52,
  }),
}))
vi.mock('@/api/client', () => ({
  api: {
    inspectDuckDb: vi.fn(),
    duckDbRelationCount: vi.fn(),
    importDuckDbRelations: vi.fn(),
    waitForJob: vi.fn(),
  },
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function relation(name: string, schema = 'main'): DuckDbRelationSummary {
  return { schema, name, type: 'table', column_count: 1, row_count: null }
}

describe('DuckDbImportDialog', () => {
  beforeEach(() => {
    toastMock.error.mockReset()
    toastMock.success.mockReset()
    vi.mocked(api.inspectDuckDb).mockReset()
    vi.mocked(api.duckDbRelationCount).mockReset()
    vi.mocked(api.importDuckDbRelations).mockReset()
    vi.mocked(api.waitForJob).mockReset()
  })

  it('shows staging copy while source id is pending', () => {
    wrap(
      <DuckDbImportDialog session={{ sourceId: '', filename: 'pending.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    expect(screen.getByText(/uploading/i)).toBeInTheDocument()
    expect(api.inspectDuckDb).not.toHaveBeenCalled()
  })

  it('filters relations by search', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([
      relation('orders'),
      relation('customers'),
    ])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Search DuckDB tables'), 'cust')
    expect(screen.queryByText('orders')).not.toBeInTheDocument()
    expect(screen.getByText('customers')).toBeInTheDocument()
  })

  it('prefills full export aliases from the database filename', async () => {
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('orders')])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'oddsfox.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    const aliasInput = screen.getByLabelText('Alias for main.orders') as HTMLInputElement
    expect(aliasInput.value).toBe('oddsfox__main__orders')
  })

  it('loads a lazy row count for one relation', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('orders')])
    vi.mocked(api.duckDbRelationCount).mockResolvedValue({ row_count: 99 })
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(api.duckDbRelationCount).toHaveBeenCalledWith('up_1', 'main', 'orders'))
    await waitFor(() => expect(screen.getByText('99')).toBeInTheDocument())
  })

  it('auto-inspects and imports selected relations', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([
      { schema: 'main', name: 'orders', type: 'table', column_count: 2, row_count: 2 },
    ])
    vi.mocked(api.importDuckDbRelations).mockResolvedValue({ job_id: 'job1', status: 'queued' })
    vi.mocked(api.waitForJob).mockResolvedValue({
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
        session={{ sourceId: 'up_1', filename: 'source.duckdb' }}
        onClose={onClose}
        onImported={onImported}
      />,
    )

    await waitFor(() => expect(api.inspectDuckDb).toHaveBeenCalledWith('up_1'))
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Select main.orders'))
    await user.click(screen.getByRole('button', { name: /Import 1/ }))

    await waitFor(() => expect(api.waitForJob).toHaveBeenCalledWith('job1', { timeoutMs: 600_000 }))
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('reports shared job polling failures during import', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('orders')])
    vi.mocked(api.importDuckDbRelations).mockResolvedValue({ job_id: 'job1', status: 'queued' })
    vi.mocked(api.waitForJob).mockRejectedValue(new Error('DuckDB import timed out.'))
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Select main.orders'))
    await user.click(screen.getByRole('button', { name: /Import 1/ }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('DuckDB import timed out.'))
  })

  it('virtualizes large relation lists', async () => {
    vi.mocked(api.inspectDuckDb).mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => relation(`table_${i}`)),
    )
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'big.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText(/101 of 101 table/)).toBeInTheDocument())
    expect(screen.getByText('table_0')).toBeInTheDocument()
  })

  it('reports row-count load failures', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('orders')])
    vi.mocked(api.duckDbRelationCount).mockRejectedValue(new Error('count failed'))
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('count failed'))
  })

  it('shows empty search results', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('orders')])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Search DuckDB tables'), 'zzznomatch')
    expect(screen.getByText(/No tables match the current filters/)).toBeInTheDocument()
  })

  it('filters relations by schema', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([
      relation('orders', 'main'),
      relation('facts', 'analytics'),
    ])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Filter by schema analytics' }))
    expect(screen.queryByText('orders')).not.toBeInTheDocument()
    expect(screen.getByText('facts')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 table/)).toBeInTheDocument()
  })

  it('combines schema and search filters', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([
      relation('orders', 'main'),
      relation('customers', 'main'),
      relation('facts', 'analytics'),
    ])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Filter by schema main' }))
    await user.type(screen.getByLabelText('Search DuckDB tables'), 'cust')
    expect(screen.queryByText('orders')).not.toBeInTheDocument()
    expect(screen.getByText('customers')).toBeInTheDocument()
  })

  it('selects a relation when its row is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('orders')])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
    const checkbox = screen.getByLabelText('Select main.orders')
    expect(checkbox).not.toBeChecked()
    await user.click(screen.getByText('orders'))
    expect(checkbox).toBeChecked()
    await user.click(screen.getByText('orders'))
    expect(checkbox).not.toBeChecked()
  })

  it('does not toggle selection when editing the alias', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('orders')])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByLabelText('Alias for main.orders')).toBeInTheDocument())
    await user.click(screen.getByLabelText('Alias for main.orders'))
    expect(screen.getByLabelText('Select main.orders')).not.toBeChecked()
  })

  it('selects all filtered relations', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockResolvedValue([relation('a'), relation('b')])
    wrap(
      <DuckDbImportDialog session={{ sourceId: 'up_1', filename: 'source.duckdb' }} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByLabelText('Select main.a')).toBeChecked()
    expect(screen.getByLabelText('Select main.b')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByLabelText('Select main.a')).not.toBeChecked()
  })
})

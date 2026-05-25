import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { DatasetIngestionProvider } from '@/features/datasets/DatasetIngestionProvider'
import { DatasetSidebar } from '@/features/datasets/DatasetSidebar'
import { useUiStore } from '@/store/uiStore'

function SearchProbe() {
  const [sp] = useSearchParams()
  return <span data-testid="ds-param">{sp.get('ds') ?? ''}</span>
}

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))

vi.mock('@/api/client', () => ({
  api: {
    listDatasets: vi.fn(),
    uploadDatasets: vi.fn(),
    uploadDuckDb: vi.fn(),
    duckDbCapabilities: vi.fn(),
    pickLocalDuckDb: vi.fn(),
    openLocalDuckDb: vi.fn(),
    duckDbRelationCount: vi.fn(),
    deleteDataset: vi.fn(),
    inspectDuckDb: vi.fn(),
    importDuckDbRelations: vi.fn(),
    getJob: vi.fn(),
  },
}))

function wrap(ui: React.ReactElement, initialEntry = '/') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={qc}>
        <DatasetIngestionProvider>{ui}</DatasetIngestionProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('DatasetSidebar', () => {
  beforeEach(() => {
    useUiStore.getState().setSidebarCollapsed(false)
    toastMock.error.mockReset()
    toastMock.success.mockReset()
    vi.mocked(api.deleteDataset).mockReset()
    vi.mocked(api.uploadDuckDb).mockReset()
    vi.mocked(api.inspectDuckDb).mockReset()
    vi.mocked(api.importDuckDbRelations).mockReset()
    vi.mocked(api.getJob).mockReset()
    vi.mocked(api.listDatasets).mockResolvedValue([
      {
        dataset_id: 'ds_001',
        name: 'a.csv',
        view_name: 'a',
        source_path: '/p',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 1,
      },
    ])
    vi.mocked(api.uploadDatasets).mockResolvedValue([
      {
        dataset_id: 'ds_002',
        name: 'b.csv',
        view_name: 'b',
        source_path: '/up/b.csv',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 1,
      },
    ])
    vi.mocked(api.deleteDataset).mockResolvedValue(undefined)
    vi.mocked(api.duckDbCapabilities).mockResolvedValue({
      local_open_enabled: true,
      upload_soft_max_bytes: 1024 * 1024 * 1024,
      inspect_include_row_counts_default: false,
      native_pick_enabled: true,
    })
    vi.mocked(api.pickLocalDuckDb).mockResolvedValue({
      source_id: 'loc_sidebar',
      filename: 'picked.duckdb',
      source_kind: 'local',
    })
    vi.mocked(api.uploadDuckDb).mockResolvedValue({
      source_id: 'up_1',
      filename: 'source.duckdb',
      source_kind: 'upload',
    })
    vi.mocked(api.inspectDuckDb).mockResolvedValue([
      { schema: 'main', name: 'orders', type: 'table', column_count: 2, row_count: 2 },
      { schema: 'main', name: 'large_orders', type: 'view', column_count: 2, row_count: 1 },
    ])
    vi.mocked(api.importDuckDbRelations).mockResolvedValue({ job_id: 'job_import', status: 'queued' })
    vi.mocked(api.getJob).mockResolvedValue({
      job_id: 'job_import',
      kind: 'duckdb_import',
      dataset_id: null,
      status: 'completed',
      progress: 1,
      cancel_requested: false,
      created_at: 'now',
      updated_at: 'now',
      finished_at: 'now',
      result: {
        datasets: [
          {
            dataset_id: 'ds_003',
            name: 'orders.parquet',
            view_name: 'orders',
            source_path: 'orders.parquet',
            format: 'parquet',
            row_count: null,
            column_count: null,
            file_size_bytes: 100,
          },
        ],
      },
    })
  })

  it('lists datasets and selects', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    await user.click(screen.getByText(/^a$/))
  })

  it('removes ds from the URL when deleting that dataset (stale ?ds would 404)', async () => {
    const user = userEvent.setup()
    wrap(
      <>
        <SearchProbe />
        <DatasetSidebar />
      </>,
      '/?ds=ds_001',
    )
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Remove a' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Remove$/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^Remove$/ }))

    await waitFor(() => expect(api.deleteDataset).toHaveBeenCalledWith('ds_001'))
    await waitFor(() => expect(screen.getByTestId('ds-param').textContent).toBe(''))
  })

  it('removes a dataset after confirmation', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Remove a' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Remove$/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^Remove$/ }))

    await waitFor(() => expect(api.deleteDataset).toHaveBeenCalledWith('ds_001'))
    expect(toastMock.success).toHaveBeenCalledWith('Removed a.csv.')
  })

  it('does not remove a dataset when confirmation is cancelled', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Remove a' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }))

    expect(api.deleteDataset).not.toHaveBeenCalled()
  })

  it('loading and error', async () => {
    vi.mocked(api.listDatasets).mockImplementation(() => new Promise(() => {}))
    const { unmount } = wrap(<DatasetSidebar />)
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    unmount()

    vi.mocked(api.listDatasets).mockRejectedValue(new Error('le'))
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText('le')).toBeInTheDocument())
  })

  it('uploads a chosen CSV via file input', async () => {
    const user = userEvent.setup()
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    const fileInput = container.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement
    const f = new File(['id\n1'], 'x.csv', { type: 'text/csv' })
    await user.upload(fileInput, f)

    await waitFor(() => {
      expect(vi.mocked(api.uploadDatasets)).toHaveBeenCalled()
      const arg = vi.mocked(api.uploadDatasets).mock.calls[0]![0]
      expect(arg).toHaveLength(1)
      expect(arg[0]!.name).toBe('x.csv')
    })
  })

  it('upload failures show error', async () => {
    const user = userEvent.setup()
    vi.mocked(api.uploadDatasets).mockRejectedValue(new Error('nf'))
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    const fileInput = container.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement
    await user.upload(fileInput, new File(['1'], 'y.csv', { type: 'text/csv' }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('nf'))
  })

  it('rejects unsupported uploads from file input', async () => {
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    const fileInput = container.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement
    const bad = new File(['x'], 'bad.exe', { type: 'application/octet-stream' })
    Object.defineProperty(fileInput, 'files', { value: [bad], configurable: true })
    fireEvent.change(fileInput)
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/No supported files/),
      ),
    )
  })

  it('filters mixed file list to supported extensions only', async () => {
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    vi.mocked(api.uploadDatasets).mockClear()
    const fileInput = container.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement
    const files = [
      new File(['a'], 'ok.csv', { type: 'text/csv' }),
      new File(['b'], 'bad.exe'),
      new File(['c'], 'readme'),
    ]
    Object.defineProperty(fileInput, 'files', { value: files, configurable: true })
    fireEvent.change(fileInput)
    await waitFor(() => {
      const arg = vi.mocked(api.uploadDatasets).mock.calls[0]![0]
      expect(arg).toHaveLength(1)
      expect(arg[0]!.name).toBe('ok.csv')
    })
  })

  it('shows error when file list is empty after picking', async () => {
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    const fileInput = container.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement
    Object.defineProperty(fileInput, 'files', { value: [], configurable: true })
    fireEvent.change(fileInput)
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/No supported files/),
      ),
    )
  })

  it('drops supported files onto the drop zone', async () => {
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    const btn = screen.getByRole('button', { name: /Upload files/ })
    const zone = btn.parentElement!
    const file = new File(['a'], 'dropped.csv', { type: 'text/csv' })
    const dt = new DataTransfer()
    dt.items.add(file)
    fireEvent.dragEnter(zone)
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('border-[hsl(var(--accent))]')
    fireEvent.dragLeave(zone, { relatedTarget: document.body })
    fireEvent.dragEnter(zone)
    fireEvent.drop(zone, { dataTransfer: dt })
    await waitFor(() => expect(vi.mocked(api.uploadDatasets)).toHaveBeenCalled())
  })

  it('normalizes backslashes in webkitRelativePath', async () => {
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    vi.mocked(api.uploadDatasets).mockClear()
    const folderInput = container.querySelector('input[webkitdirectory]') as HTMLInputElement
    const f = new File(['1'], 'leaf.csv', { type: 'text/csv' })
    Object.defineProperty(f, 'webkitRelativePath', {
      value: 'dir\\sub\\z.csv',
      enumerable: true,
    })
    Object.defineProperty(folderInput, 'files', { value: [f], configurable: true })
    fireEvent.change(folderInput)
    await waitFor(() => {
      const arg = vi.mocked(api.uploadDatasets).mock.calls[0]![0]
      expect(arg[0]!.name).toBe('dir__sub__z.csv')
    })
  })

  it('activates file picker from keyboard on drop zone', async () => {
    const user = userEvent.setup()
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    const fileInput = container.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {})
    const zone = screen.getByRole('button', { name: /Upload files/ })
    zone.focus()
    await user.keyboard('{Enter}')
    expect(clickSpy).toHaveBeenCalled()
    await user.keyboard(' ')
    expect(clickSpy).toHaveBeenCalledTimes(2)
    clickSpy.mockRestore()
  })

  it('shows busy spinner on folder button while upload pending', async () => {
    const user = userEvent.setup()
    vi.mocked(api.uploadDatasets).mockImplementation(() => new Promise(() => {}))
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    const fileInput = container.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement
    void user.upload(fileInput, new File(['x'], 'p.csv'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Folder' })).toBeDisabled(),
    )
  })

  async function openDuckDbImport(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Import DuckDB' }))
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
    await waitFor(() => expect(api.inspectDuckDb).toHaveBeenCalledWith('loc_sidebar'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Import DuckDB' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('orders')).toBeInTheDocument())
  }

  it('opens duckdb via Import DuckDB and native pick', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Import DuckDB' }))
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Import DuckDB' })).toBeInTheDocument())
  })

  it('uploads and imports selected DuckDB relations', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await openDuckDbImport(user)

    await user.click(screen.getByLabelText('Select main.orders'))
    const aliasInput = screen.getByLabelText('Alias for main.orders')
    await user.clear(aliasInput)
    await user.type(aliasInput, 'orders_copy')
    await user.click(screen.getByRole('button', { name: /Import 1/ }))

    await waitFor(() =>
      expect(api.importDuckDbRelations).toHaveBeenCalledWith('loc_sidebar', [
        { schema: 'main', name: 'orders', alias: 'orders_copy' },
      ]),
    )
    await waitFor(() => expect(api.getJob).toHaveBeenCalledWith('job_import'))
    expect(toastMock.success).toHaveBeenCalledWith('Imported 1 DuckDB relation(s).')
  })

  it('selects and clears all inspected DuckDB relations', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await openDuckDbImport(user)

    await user.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByLabelText('Select main.orders')).toBeChecked()
    expect(screen.getByLabelText('Select main.large_orders')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByLabelText('Select main.orders')).not.toBeChecked()
    expect(screen.getByLabelText('Select main.large_orders')).not.toBeChecked()
  })

  it('shows collapsed sidebar upload control', async () => {
    useUiStore.getState().setSidebarCollapsed(true)
    const user = userEvent.setup()
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByTitle('ds_001 - /p')).toBeInTheDocument())
    const fileInput = container.querySelector('input[aria-label="Upload data files"]') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: 'Upload files' }))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('routes duckdb-only folder picks through native import', async () => {
    const { container } = wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    const folderInput = container.querySelector('input[webkitdirectory]') as HTMLInputElement
    const f = new File(['db'], 'only.duckdb')
    Object.defineProperty(folderInput, 'files', { value: [f], configurable: true })
    fireEvent.change(folderInput)
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
  })

  it('opens DuckDB import from Import DuckDB in an empty workspace', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listDatasets).mockResolvedValue([])
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/No datasets in this workspace/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Import DuckDB' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Import DuckDB' })).toBeInTheDocument())
  })

  it('shows DuckDB import job failures', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getJob).mockResolvedValue({
      job_id: 'job_import',
      kind: 'duckdb_import',
      dataset_id: null,
      status: 'failed',
      progress: 1,
      error_message: 'copy failed',
      cancel_requested: false,
      created_at: 'now',
      updated_at: 'now',
      finished_at: 'now',
      result: null,
    })
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await openDuckDbImport(user)
    await user.click(screen.getByLabelText('Select main.orders'))
    await user.click(screen.getByRole('button', { name: /Import 1/ }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('copy failed'))
  })

  it('validates DuckDB import requires selected relations', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await openDuckDbImport(user)
    await user.click(screen.getByRole('button', { name: /^Import\s*$/ }))
    expect(toastMock.error).toHaveBeenCalledWith('Select at least one DuckDB table or view.')
  })

  it('shows DuckDB inspect errors', async () => {
    const user = userEvent.setup()
    vi.mocked(api.inspectDuckDb).mockRejectedValue(new Error('cannot inspect'))
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Import DuckDB' }))
    await waitFor(() => expect(screen.getByText('cannot inspect')).toBeInTheDocument())
  })
})

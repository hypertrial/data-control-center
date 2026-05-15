import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { DatasetSidebar } from '@/features/datasets/DatasetSidebar'

function SearchProbe() {
  const [sp] = useSearchParams()
  return <span data-testid="ds-param">{sp.get('ds') ?? ''}</span>
}

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))

vi.mock('@/api/client', () => ({
  api: {
    listDatasets: vi.fn(),
    uploadDatasets: vi.fn(),
    deleteDataset: vi.fn(),
  },
}))

function wrap(ui: React.ReactElement, initialEntry = '/') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('DatasetSidebar', () => {
  beforeEach(() => {
    toastMock.error.mockReset()
    toastMock.success.mockReset()
    vi.mocked(api.deleteDataset).mockReset()
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
  })

  it('lists datasets and selects', async () => {
    const user = userEvent.setup()
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())
    await user.click(screen.getByText(/^a$/))
  })

  it('removes ds from the URL when deleting that dataset (stale ?ds would 404)', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(
      <>
        <SearchProbe />
        <DatasetSidebar />
      </>,
      '/?ds=ds_001',
    )
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Remove a' }))

    await waitFor(() => expect(api.deleteDataset).toHaveBeenCalledWith('ds_001'))
    await waitFor(() => expect(screen.getByTestId('ds-param').textContent).toBe(''))
  })

  it('removes a dataset after confirmation', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Remove a' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Remove a.csv from this workspace? The source file will not be deleted.',
    )
    await waitFor(() => expect(api.deleteDataset).toHaveBeenCalledWith('ds_001'))
    expect(toastMock.success).toHaveBeenCalledWith('Removed a.csv.')
  })

  it('does not remove a dataset when confirmation is cancelled', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    wrap(<DatasetSidebar />)
    await waitFor(() => expect(screen.getByText(/^a$/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Remove a' }))

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
})

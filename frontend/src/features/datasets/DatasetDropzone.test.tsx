import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { DatasetDropzone } from '@/features/datasets/DatasetDropzone'
import { useUiStore } from '@/store/uiStore'

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/api/client', () => ({
  api: {
    uploadDatasets: vi.fn(),
  },
}))

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <DatasetDropzone />
    </QueryClientProvider>,
  )
}

describe('DatasetDropzone', () => {
  beforeEach(() => {
    toastMock.error.mockReset()
    toastMock.success.mockReset()
    vi.mocked(api.uploadDatasets).mockResolvedValue([
      {
        dataset_id: 'ds_2',
        name: 'x.csv',
        view_name: 'x',
        source_path: '/x.csv',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 10,
      },
    ])
  })

  it('uploads selected supported files', async () => {
    const user = userEvent.setup()
    const { container } = wrap()
    const input = container.querySelector('input[aria-label="Upload data files"]') as HTMLInputElement

    await user.upload(input, new File(['id\n1'], 'x.csv', { type: 'text/csv' }))

    await waitFor(() => expect(api.uploadDatasets).toHaveBeenCalled())
    expect(useUiStore.getState().activeDatasetId).toBe('ds_2')
    expect(toastMock.success).toHaveBeenCalledWith('Registered 1 file(s).')
  })

  it('handles drops, drag leave, unsupported files, and upload errors', async () => {
    vi.mocked(api.uploadDatasets).mockRejectedValueOnce(new Error('upload failed'))
    const { container } = wrap()
    const zone = screen.getByRole('button', { name: /Drop files here/i })
    const file = new File(['id\n1'], 'x.csv', { type: 'text/csv' })
    const dt = new DataTransfer()
    dt.items.add(file)

    fireEvent.dragEnter(zone)
    expect(zone.className).toContain('border-[hsl(var(--accent))]')
    fireEvent.dragLeave(zone, { relatedTarget: document.body })
    fireEvent.drop(zone, { dataTransfer: dt })
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('upload failed'))

    const input = container.querySelector('input[aria-label="Upload data files"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'bad.exe')], configurable: true })
    fireEvent.change(input)
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/No supported files/)))
  })
})

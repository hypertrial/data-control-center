import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { useDatasetIngestion } from '@/features/datasets/useDatasetIngestion'

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/api/client', () => ({
  api: {
    uploadDatasets: vi.fn(),
    uploadDuckDb: vi.fn(),
  },
}))

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('useDatasetIngestion', () => {
  beforeEach(() => {
    toastMock.error.mockReset()
    toastMock.success.mockReset()
    toastMock.message.mockReset()
    vi.mocked(api.uploadDatasets).mockReset()
    vi.mocked(api.uploadDuckDb).mockReset()
  })

  it('uploads data files and stages duckdb files', async () => {
    vi.mocked(api.uploadDatasets).mockResolvedValue([
      {
        dataset_id: 'ds_1',
        name: 'a.csv',
        view_name: 'a',
        source_path: '/a.csv',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 1,
      },
    ])
    vi.mocked(api.uploadDuckDb).mockResolvedValue({ upload_id: 'up_1', filename: 'b.duckdb' })

    const setActiveDatasetId = vi.fn()
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId }), { wrapper: wrapper() })

    await result.current.ingestFiles([
      new File(['a'], 'a.csv'),
      new File(['b'], 'b.duckdb'),
    ])

    await waitFor(() => expect(api.uploadDatasets).toHaveBeenCalled())
    await waitFor(() => expect(api.uploadDuckDb).toHaveBeenCalled())
    expect(result.current.duckDbSession).toEqual({ uploadId: 'up_1', filename: 'b.duckdb' })
    expect(setActiveDatasetId).toHaveBeenCalledWith('ds_1')
  })

  it('rejects unsupported file batches', async () => {
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await result.current.ingestFiles([new File(['x'], 'bad.exe')])
    expect(toastMock.error).toHaveBeenCalled()
    expect(api.uploadDatasets).not.toHaveBeenCalled()
  })

  it('surfaces staged upload errors when advancing the duckdb queue', async () => {
    vi.mocked(api.uploadDuckDb)
      .mockResolvedValueOnce({ upload_id: 'up_1', filename: 'first.duckdb' })
      .mockRejectedValueOnce(new Error('stage failed'))

    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })

    await result.current.ingestFiles([
      new File(['a'], 'first.duckdb'),
      new File(['b'], 'second.duckdb'),
    ])
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ uploadId: 'up_1', filename: 'first.duckdb' }),
    )

    result.current.closeDuckDbSession()
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('stage failed'))
  })
})

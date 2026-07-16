import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { DUCKDB_USE_IMPORT_MESSAGE } from '@/features/datasets/uploadFiles'
import { useDatasetIngestion } from '@/features/datasets/useDatasetIngestion'

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/api/client', () => ({
  api: {
    uploadDatasets: vi.fn(),
    uploadDuckDb: vi.fn(),
    duckDbCapabilities: vi.fn(),
    pickLocalDuckDb: vi.fn(),
    openLocalDuckDb: vi.fn(),
  },
}))

const defaultCaps = {
  local_open_enabled: true,
  upload_soft_max_bytes: 1024 * 1024 * 1024,
  inspect_include_row_counts_default: false,
  native_pick_enabled: true,
  view_import_enabled: true,
}

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
    vi.mocked(api.duckDbCapabilities).mockReset()
    vi.mocked(api.duckDbCapabilities).mockResolvedValue(defaultCaps)
    vi.mocked(api.pickLocalDuckDb).mockReset()
    vi.mocked(api.openLocalDuckDb).mockReset()
    vi.mocked(api.pickLocalDuckDb).mockResolvedValue({
      source_id: 'loc_1',
      filename: 'picked.duckdb',
      source_kind: 'local',
    })
  })

  it('uploads tabular files and opens duckdb via native pick', async () => {
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

    const setActiveDatasetId = vi.fn()
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId }), { wrapper: wrapper() })

    await result.current.ingestFiles([
      new File(['a'], 'a.csv'),
      new File(['b'], 'b.duckdb'),
    ])

    await waitFor(() => expect(api.uploadDatasets).toHaveBeenCalled())
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
    expect(api.uploadDuckDb).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'loc_1', filename: 'picked.duckdb' }),
    )
    expect(setActiveDatasetId).toHaveBeenCalledWith('ds_1')
  })

  it('signals navigation only when creating the first dataset', async () => {
    const first = {
      dataset_id: 'ds_1', name: 'a.csv', view_name: 'a', source_path: 'a.csv', format: 'csv',
      row_count: 1, column_count: 1, file_size_bytes: 1,
    }
    vi.mocked(api.uploadDatasets).mockResolvedValue([first])
    const onFirstDataset = vi.fn()
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useDatasetIngestion({ setActiveDatasetId: vi.fn(), onFirstDataset }),
      { wrapper: Wrapper },
    )

    await result.current.ingestFiles([new File(['a'], 'a.csv')])
    expect(onFirstDataset).toHaveBeenCalledTimes(1)

    qc.setQueryData(['datasets'], [first])
    await result.current.ingestFiles([new File(['b'], 'b.csv')])
    expect(onFirstDataset).toHaveBeenCalledTimes(1)
  })

  it('opens small duckdb files via native pick instead of browser upload', async () => {
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await result.current.ingestFiles([new File(['db'], 'small.duckdb')])

    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalledTimes(1))
    expect(api.uploadDuckDb).not.toHaveBeenCalled()
  })

  it('rejects unsupported file batches', async () => {
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await result.current.ingestFiles([new File(['x'], 'bad.exe')])
    expect(toastMock.error).toHaveBeenCalled()
    expect(api.uploadDatasets).not.toHaveBeenCalled()
  })

  it('shows guidance toast when duckdb is dropped without a host path', async () => {
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await result.current.ingestFiles([new File(['db'], 'big.duckdb')])
    expect(toastMock.message).toHaveBeenCalledWith(DUCKDB_USE_IMPORT_MESSAGE)
  })

  it('opens duckdb dropped via browser via a single native pick', async () => {
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await result.current.ingestFiles([new File(['x'.repeat(20)], 'big.duckdb')])

    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalledTimes(1))
    expect(api.uploadDuckDb).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'loc_1', filename: 'picked.duckdb' }),
    )
  })

  it('opens duckdb from the host file path when available', async () => {
    vi.mocked(api.duckDbCapabilities).mockResolvedValue({
      ...defaultCaps,
      upload_soft_max_bytes: 10,
    })
    vi.mocked(api.openLocalDuckDb).mockResolvedValue({
      source_id: 'loc_path',
      filename: 'big.duckdb',
      source_kind: 'local',
    })
    const file = new File(['x'.repeat(20)], 'big.duckdb')
    Object.defineProperty(file, 'path', { value: '/Volumes/data/big.duckdb' })

    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await result.current.ingestFiles([file])

    await waitFor(() => expect(api.openLocalDuckDb).toHaveBeenCalledWith('/Volumes/data/big.duckdb'))
    expect(api.pickLocalDuckDb).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'loc_path', filename: 'big.duckdb' }),
    )
  })

  it('falls back to the manual open dialog when native pick is unavailable', async () => {
    vi.mocked(api.duckDbCapabilities).mockResolvedValue({
      ...defaultCaps,
      native_pick_enabled: false,
      upload_soft_max_bytes: 10,
    })

    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await result.current.ingestFiles([new File(['x'.repeat(20)], 'big.duckdb')])

    expect(toastMock.message).toHaveBeenCalledWith(DUCKDB_USE_IMPORT_MESSAGE)
    await waitFor(() => expect(result.current.duckDbOpenOpen).toBe(true))
    expect(api.pickLocalDuckDb).not.toHaveBeenCalled()
  })

  it('ignores cancelled native picks', async () => {
    vi.mocked(api.pickLocalDuckDb).mockRejectedValue(new Error('File selection was cancelled'))

    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await result.current.ingestFiles([new File(['db'], 'big.duckdb')])
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('opens the manual dialog from the sidebar when native pick is unavailable', async () => {
    vi.mocked(api.duckDbCapabilities).mockResolvedValue({
      ...defaultCaps,
      native_pick_enabled: false,
    })
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await act(async () => {
      await result.current.openDuckDbFromDisk('hint')
    })
    await waitFor(() => expect(result.current.duckDbOpenOpen).toBe(true))
    expect(result.current.duckDbOpenHint).toBe('hint')
  })

  it('ignores cancelled picks from Import DuckDB', async () => {
    vi.mocked(api.pickLocalDuckDb).mockRejectedValue(new Error('File selection was cancelled'))
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await act(async () => {
      await result.current.openDuckDbFromDisk()
    })
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('opens a session after manual disk open', async () => {
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    act(() => {
      result.current.handleDuckDbOpenedFromDisk('loc_manual', 'manual.duckdb')
    })
    expect(result.current.duckDbSession).toEqual({ sourceId: 'loc_manual', filename: 'manual.duckdb' })
    expect(result.current.duckDbOpenOpen).toBe(false)
  })

  it('uses native pick for Import DuckDB', async () => {
    vi.mocked(api.pickLocalDuckDb).mockResolvedValue({
      source_id: 'loc_9',
      filename: 'warehouse.duckdb',
      source_kind: 'local',
    })
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())

    await act(async () => {
      await result.current.openDuckDbFromDisk()
    })
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'loc_9', filename: 'warehouse.duckdb' }),
    )
  })

  it('queues multiple duckdb drops for sequential native picks', async () => {
    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.duckDbCapabilities).toBeDefined())
    await result.current.ingestFiles([
      new File(['a'], 'first.duckdb'),
      new File(['b'], 'second.duckdb'),
    ])
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalledTimes(1))
    expect(toastMock.message).toHaveBeenCalledWith(
      'Importing DuckDB files one at a time (2 selected).',
    )
  })

  it('queues native picks while an import session is already open', async () => {
    vi.mocked(api.pickLocalDuckDb)
      .mockResolvedValueOnce({ source_id: 'loc_1', filename: 'first.duckdb', source_kind: 'local' })
      .mockResolvedValueOnce({ source_id: 'loc_2', filename: 'second.duckdb', source_kind: 'local' })

    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })

    await result.current.ingestFiles([new File(['a'], 'first.duckdb')])
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'loc_1', filename: 'first.duckdb' }),
    )

    await result.current.ingestFiles([new File(['b'], 'second.duckdb')])
    expect(api.pickLocalDuckDb).toHaveBeenCalledTimes(1)

    result.current.closeDuckDbSession()
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'loc_2', filename: 'second.duckdb' }),
    )
    expect(api.pickLocalDuckDb).toHaveBeenCalledTimes(2)
  })

  it('stages duckdb uploads when native pick is disabled', async () => {
    vi.mocked(api.duckDbCapabilities).mockResolvedValue({
      ...defaultCaps,
      native_pick_enabled: false,
    })
    vi.mocked(api.uploadDuckDb)
      .mockResolvedValueOnce({ source_id: 'up_1', filename: 'first.duckdb', source_kind: 'upload' })
      .mockResolvedValueOnce({ source_id: 'up_2', filename: 'second.duckdb', source_kind: 'upload' })

    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })

    await result.current.ingestFiles([new File(['a'], 'first.duckdb')])
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'up_1', filename: 'first.duckdb' }),
    )

    await result.current.ingestFiles([new File(['b'], 'second.duckdb')])
    expect(api.uploadDuckDb).toHaveBeenCalledTimes(1)

    result.current.closeDuckDbSession()
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'up_2', filename: 'second.duckdb' }),
    )
    expect(api.uploadDuckDb).toHaveBeenCalledTimes(2)
  })

  it('surfaces staged upload errors when advancing the duckdb queue without native pick', async () => {
    vi.mocked(api.duckDbCapabilities).mockResolvedValue({
      ...defaultCaps,
      native_pick_enabled: false,
    })
    vi.mocked(api.uploadDuckDb)
      .mockResolvedValueOnce({ source_id: 'up_1', filename: 'first.duckdb', source_kind: 'upload' })
      .mockRejectedValueOnce(new Error('stage failed'))

    const { result } = renderHook(() => useDatasetIngestion({ setActiveDatasetId: vi.fn() }), {
      wrapper: wrapper(),
    })

    await result.current.ingestFiles([
      new File(['a'], 'first.duckdb'),
      new File(['b'], 'second.duckdb'),
    ])
    await waitFor(() =>
      expect(result.current.duckDbSession).toEqual({ sourceId: 'up_1', filename: 'first.duckdb' }),
    )

    result.current.closeDuckDbSession()
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('stage failed'))
  })
})

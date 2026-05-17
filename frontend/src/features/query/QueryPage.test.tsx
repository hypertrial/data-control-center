import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryPage } from '@/features/query/QueryPage'
import { useUiStore } from '@/store/uiStore'

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: function MockCM({
    value,
    onChange,
  }: {
    value: string
    onChange: (v: string) => void
  }) {
    return <textarea aria-label="SQL editor" value={value} onChange={(e) => onChange(e.target.value)} />
  },
}))

const h = vi.hoisted(() => ({
  runQuery: vi.fn(),
  listDatasets: vi.fn(),
  listSavedQueries: vi.fn(),
  createSavedQuery: vi.fn(),
  getProfile: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      runQuery: h.runQuery,
      listDatasets: h.listDatasets,
      listSavedQueries: h.listSavedQueries,
      createSavedQuery: h.createSavedQuery,
      getProfile: h.getProfile,
    },
  }
})

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: toastMock,
}))

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

const dsFooRow = {
  dataset_id: 'ds_001',
  name: 'foo.csv',
  view_name: 'foo',
  source_path: '/p/foo.csv',
  format: 'csv',
  row_count: 1,
  column_count: 1,
  file_size_bytes: 1,
}

describe('QueryPage', () => {
  beforeEach(() => {
    h.runQuery.mockReset()
    h.listDatasets.mockResolvedValue([])
    h.listSavedQueries.mockResolvedValue([])
    h.createSavedQuery.mockReset()
    h.getProfile.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    localStorage.clear()
    useUiStore.setState({
      activeDatasetId: null,
      sqlInjectTick: 0,
      pendingQuery: null,
    })
  })

  it('runs query with view hint and shows results', async () => {
    const user = userEvent.setup()
    h.runQuery.mockResolvedValue({
      columns: [{ name: 'x', type: 'int' }],
      rows: [{ x: 1 }, { x: { y: 2 } }],
      row_count: 2,
      truncated: true,
      error: null,
    })
    h.listDatasets.mockResolvedValue([dsFooRow])
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<QueryPage />)
    await waitFor(() => expect(screen.getAllByText(/foo/).length).toBeGreaterThan(0))

    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(screen.getByText(/\(truncated\)/)).toBeInTheDocument())
    expect(screen.getByText('{"y":2}')).toBeInTheDocument()
  })

  it('no active dataset view hint fallback', () => {
    useUiStore.setState({ activeDatasetId: null })
    wrap(<QueryPage />)
    expect(screen.getAllByText(/<dataset_table>/).length).toBeGreaterThan(0)
  })

  it('shows sql error and mutation error', async () => {
    const user = userEvent.setup()
    h.runQuery
      .mockResolvedValueOnce({
        columns: [],
        rows: [],
        row_count: 0,
        error: 'bad sql',
      })
      .mockRejectedValueOnce(new Error('network'))
    wrap(<QueryPage />)
    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(screen.getByText('bad sql')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(screen.getByText('network')).toBeInTheDocument())
  })

  it('pending', async () => {
    const user = userEvent.setup()
    h.runQuery.mockImplementation(() => new Promise(() => {}))
    wrap(<QueryPage />)
    await user.click(screen.getByRole('button', { name: 'Run query' }))
    expect(screen.getByText(/Running/)).toBeInTheDocument()
  })

  it('formats, copies, saves, and reuses snippets', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    h.listSavedQueries.mockResolvedValue([
      { saved_id: 'sq1', name: 'Revenue check', sql: 'SELECT revenue FROM foo' },
    ])
    h.createSavedQuery.mockResolvedValue({ saved_id: 'sq2', name: 'Pretty query', sql: 'SELECT * FROM foo' })

    localStorage.setItem('dcc-sql-history', JSON.stringify(['SELECT 42', 99, 'SELECT 7']))
    wrap(<QueryPage />)

    const editor = screen.getByLabelText('SQL editor')
    await user.clear(editor)
    await user.type(editor, 'select * from foo')

    await user.click(screen.getByRole('button', { name: 'Format' }))
    expect(screen.getByDisplayValue(/from\s+foo/i)).toBeInTheDocument()
    expect(toastMock.success).toHaveBeenCalledWith('SQL formatted')

    await user.click(screen.getByRole('button', { name: /Copy SQL/i }))
    expect(write).toHaveBeenCalled()
    expect(toastMock.success).toHaveBeenCalledWith('SQL copied')

    await user.click(screen.getByRole('button', { name: 'Snippets' }))
    await user.click(screen.getByRole('button', { name: /SELECT 42/i }))
    expect(screen.getByDisplayValue('SELECT 42')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save query' }))
    const saveInput = screen.getByLabelText('Name')
    await user.type(saveInput, 'Pretty query')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() =>
      expect(h.createSavedQuery).toHaveBeenCalledWith({
        name: 'Pretty query',
        sql: 'SELECT 42',
      }),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Saved query stored')
    write.mockRestore()
  })

  it('shows save errors', async () => {
    const user = userEvent.setup()
    h.createSavedQuery.mockRejectedValue(new Error('cannot save'))
    wrap(<QueryPage />)

    await user.click(screen.getByRole('button', { name: 'Save query' }))
    await user.type(screen.getByLabelText('Name'), 'Broken')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('cannot save'))
  })

  it('expands schema, loads profile columns, and inserts identifiers into the editor', async () => {
    const user = userEvent.setup()
    h.listDatasets.mockResolvedValue([dsFooRow])
    h.getProfile.mockResolvedValue({
      column_profiles: [{ name: 'total cost', physical_type: 'DOUBLE' }],
    })
    useUiStore.setState({ activeDatasetId: 'ds_001' })

    wrap(<QueryPage />)
    const datasetLabel = await screen.findByText('foo.csv')
    await user.click(datasetLabel.closest('button')!)
    await waitFor(() => expect(screen.getByRole('button', { name: /total cost/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /total cost/i }))
    expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toContain('foo."total cost"')
  })

  it('applies pending injected SQL and dataset templates', async () => {
    const user = userEvent.setup()
    h.listDatasets.mockResolvedValue([dsFooRow])
    useUiStore.setState({ activeDatasetId: 'ds_001', sqlInjectTick: 1, pendingQuery: 'SELECT pending' })
    wrap(<QueryPage />)

    await waitFor(() => expect(screen.getByDisplayValue('SELECT pending')).toBeInTheDocument())

    useUiStore.getState().setPendingQuery(null)
    useUiStore.setState({ activeDatasetId: null })
    await waitFor(() => expect(screen.getByDisplayValue('SELECT 1;')).toBeInTheDocument())

    useUiStore.setState({ activeDatasetId: 'ds_001' })
    await waitFor(() => expect(screen.getByDisplayValue('SELECT * FROM foo LIMIT 50;')).toBeInTheDocument())

    await user.clear(screen.getByLabelText('SQL editor'))
    await user.type(screen.getByLabelText('SQL editor'), 'SELECT history')
    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(h.runQuery).toHaveBeenCalled())
    expect(JSON.parse(localStorage.getItem('dcc-sql-history') ?? '[]')).toContain('SELECT history')
  })
})

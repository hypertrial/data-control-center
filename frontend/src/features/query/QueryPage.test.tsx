import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryPage } from '@/features/query/QueryPage'
import { useUiStore } from '@/store/uiStore'

let mockSelection = ''

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: React.forwardRef(function MockCM(
    {
      value,
      onChange,
      onSelectionChange,
    }: {
      value: string
      onChange: (v: string) => void
      onSelectionChange?: (s: string) => void
    },
    ref: React.ForwardedRef<{ view?: { state: { selection: { main: { from: number; to: number } }; sliceDoc: () => string } } }>,
  ) {
    React.useImperativeHandle(ref, () => ({
      view: {
        state: {
          selection: { main: { from: 0, to: mockSelection.length } },
          sliceDoc: () => mockSelection,
        },
      },
    }))
    React.useLayoutEffect(() => {
      onSelectionChange?.(mockSelection)
    }, [onSelectionChange])
    return (
      <textarea
        aria-label="SQL editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSelect={() => onSelectionChange?.(mockSelection)}
      />
    )
  }),
}))

const h = vi.hoisted(() => ({
  runQuery: vi.fn(),
  listDatasets: vi.fn(),
  listSavedQueries: vi.fn(),
  createSavedQuery: vi.fn(),
  deleteSavedQuery: vi.fn(),
  fetchDatasetProfile: vi.fn(), fetchDatasetProfileOnce: vi.fn(),
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
      deleteSavedQuery: h.deleteSavedQuery,
      fetchDatasetProfile: h.fetchDatasetProfile,
      fetchDatasetProfileOnce: h.fetchDatasetProfileOnce,
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
      <QueryClientProvider client={qc}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const dsFooRow = {
  dataset_id: 'ds_001',
  name: 'foo.csv',
  view_name: 'foo',
  source_path: '/p/foo.csv',
  format: 'csv',
  row_count: 12,
  column_count: 3,
  file_size_bytes: 1,
}

describe('QueryPage', () => {
  beforeEach(() => {
    mockSelection = ''
    h.runQuery.mockReset()
    h.listDatasets.mockResolvedValue([])
    h.listSavedQueries.mockResolvedValue([])
    h.createSavedQuery.mockReset()
    h.deleteSavedQuery.mockResolvedValue(undefined)
    h.fetchDatasetProfileOnce.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    localStorage.clear()
    useUiStore.setState({
      activeDatasetId: null,
      sqlInjectTick: 0,
      pendingQuery: null,
      sqlEditorHeight: 280,
      sqlSchemaCollapsed: true,
    })
  })

  it('renders active dataset chip with name and counts', async () => {
    h.listDatasets.mockResolvedValue([dsFooRow])
    h.fetchDatasetProfileOnce.mockResolvedValue({ rows: 12, columns: 3, column_profiles: [] })
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<QueryPage />)
    const chip = await screen.findByTestId('sql-active-dataset-chip')
    expect(chip).toHaveTextContent('foo.csv')
    expect(chip).toHaveTextContent('12 rows')
    expect(chip).toHaveTextContent('3 cols')
  })

  it('runs query and shows results with timer chip', async () => {
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
    await waitFor(() => expect(screen.getByTestId('sql-active-dataset-chip')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(screen.getByText(/\(truncated\)/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/\d+ms · 2 rows/)).toBeInTheDocument())
    expect(screen.getByText('{"y":2}')).toBeInTheDocument()
  })

  it('shows run selection label and runs only selected SQL', async () => {
    const user = userEvent.setup()
    h.runQuery.mockResolvedValue({
      columns: [],
      rows: [],
      row_count: 0,
      truncated: false,
      error: null,
    })
    mockSelection = 'SELECT partial'
    wrap(<QueryPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run selection' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Run selection' }))
    await waitFor(() => expect(h.runQuery).toHaveBeenCalled())
    expect(h.runQuery.mock.calls.at(-1)?.[0]).toEqual({ sql: 'SELECT partial', max_rows: 1000 })
  })

  it('shows running timer chip while pending', async () => {
    const user = userEvent.setup()
    h.runQuery.mockImplementation(() => new Promise(() => {}))
    wrap(<QueryPage />)
    await user.click(screen.getByRole('button', { name: 'Run query' }))
    expect(screen.getByText(/RUNNING/i)).toBeInTheDocument()
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

  it('formats, copies, saves, and reuses snippets', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    h.listSavedQueries.mockResolvedValue([
      { saved_id: 'sq1', name: 'Revenue check', sql: 'SELECT revenue FROM foo', description: null, created_at: 't', updated_at: 't' },
    ])
    h.createSavedQuery.mockResolvedValue({
      saved_id: 'sq2',
      name: 'Pretty query',
      sql: 'SELECT * FROM foo',
      description: 'Helpful note',
      created_at: 't',
      updated_at: 't',
    })

    localStorage.setItem('dcc-sql-history', JSON.stringify(['SELECT 42', 99, 'SELECT 7']))
    wrap(<QueryPage />)

    const editor = screen.getByLabelText('SQL editor')
    fireEvent.change(editor, { target: { value: 'select * from foo' } })

    await user.click(screen.getByRole('button', { name: 'Format' }))
    expect(screen.getByLabelText('SQL editor')).toHaveValue(['select *', 'from foo;'].join('\n'))
    expect(toastMock.success).toHaveBeenCalledWith('SQL formatted')

    await user.click(screen.getByRole('button', { name: 'Copy SQL' }))
    expect(write).toHaveBeenCalled()
    expect(toastMock.success).toHaveBeenCalledWith('SQL copied')

    await user.click(screen.getByRole('button', { name: /Snippets/i }))
    await user.click(screen.getByRole('button', { name: /SELECT 42/i }))
    expect(screen.getByDisplayValue('SELECT 42')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save query' }))
    const saveInput = screen.getByLabelText('Name')
    await user.type(saveInput, 'Pretty query')
    await user.type(screen.getByLabelText('Description (optional)'), 'Helpful note')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() =>
      expect(h.createSavedQuery).toHaveBeenCalledWith({
        name: 'Pretty query',
        sql: 'SELECT 42',
        description: 'Helpful note',
      }),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Saved query stored')
    write.mockRestore()
  })

  it('shows save errors and duplicate-name warning', async () => {
    const user = userEvent.setup()
    h.listSavedQueries.mockResolvedValue([
      { saved_id: 'sq1', name: 'Dup', sql: 'SELECT 1', description: null, created_at: 't', updated_at: 't' },
    ])
    h.createSavedQuery.mockRejectedValue(new Error('cannot save'))
    wrap(<QueryPage />)

    await user.click(screen.getByRole('button', { name: 'Save query' }))
    await user.type(screen.getByLabelText('Name'), 'Dup')
    expect(screen.getByText(/already exists with this name/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('cannot save'))
  })

  it('schema rail starts collapsed and expands active dataset', async () => {
    const user = userEvent.setup()
    h.listDatasets.mockResolvedValue([dsFooRow])
    h.fetchDatasetProfileOnce.mockResolvedValue({
      column_profiles: [{ name: 'total cost', physical_type: 'DOUBLE' }],
    })
    useUiStore.setState({ activeDatasetId: 'ds_001', sqlSchemaCollapsed: true })

    wrap(<QueryPage />)
    const rail = screen.getByTestId('sql-schema-rail')
    expect(rail).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByText('total cost')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand schema rail' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /total cost/i })).toBeInTheDocument())
  })

  it('applies pending injected SQL and dataset templates', async () => {
    const user = userEvent.setup()
    h.listDatasets.mockResolvedValue([dsFooRow])
    useUiStore.setState({ activeDatasetId: 'ds_001', sqlInjectTick: 1, pendingQuery: 'SELECT pending' })
    wrap(<QueryPage />)

    await waitFor(() => expect(screen.getByDisplayValue('select pending;')).toBeInTheDocument())

    useUiStore.getState().setPendingQuery(null)
    useUiStore.setState({ activeDatasetId: null })
    await waitFor(() => expect(screen.getByDisplayValue('select pending;')).toBeInTheDocument())

    await user.clear(screen.getByLabelText('SQL editor'))
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    await waitFor(() =>
      expect((screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value).toBe(
        ['select *', 'from foo', 'limit 50;'].join('\n'),
      ),
    )

    await user.clear(screen.getByLabelText('SQL editor'))
    await user.type(screen.getByLabelText('SQL editor'), 'SELECT history')
    await user.click(screen.getByRole('button', { name: 'Run query' }))
    await waitFor(() => expect(h.runQuery).toHaveBeenCalled())
    expect(JSON.parse(localStorage.getItem('dcc-sql-history') ?? '[]')).toContain('SELECT history')
  })

  it('runs latest SQL and max rows from keyboard shortcut', async () => {
    const user = userEvent.setup()
    h.runQuery.mockResolvedValue({
      columns: [],
      rows: [],
      row_count: 0,
      truncated: false,
      error: null,
    })
    wrap(<QueryPage />)

    const editor = screen.getByLabelText('SQL editor')
    await waitFor(() => expect(screen.getByDisplayValue('select 1;')).toBeInTheDocument())
    fireEvent.change(editor, { target: { value: 'SELECT latest' } })
    await waitFor(() => expect(screen.getByDisplayValue('SELECT latest')).toBeInTheDocument())
    const maxRows = screen.getByLabelText('max_rows')
    fireEvent.change(maxRows, { target: { value: '7' } })
    await user.click(editor)
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    await waitFor(() => expect(h.runQuery).toHaveBeenCalled())
    expect(h.runQuery.mock.calls.at(-1)?.[0]).toEqual({
      sql: 'SELECT latest',
      max_rows: 7,
    })
  })
})

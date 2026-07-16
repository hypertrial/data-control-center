import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import App from '@/App'
import { appQueryClient } from '@/appQueryClient'
import { useUiStore } from '@/store/uiStore'
import { mkProfile } from '@/test/profileFixtures'

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispatchAction: vi.fn(),
    getDataURL: vi.fn(() => 'data:image/png;base64,test'),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listDatasets: vi.fn(),
      uploadDatasets: vi.fn(),
      fetchDatasetProfile: vi.fn(),
      fetchDatasetProfileOnce: vi.fn(),
      getSample: vi.fn(),
      runQuery: vi.fn(),
      getProfileHistory: vi.fn(),
      getProfileDiff: vi.fn(),
      listSavedQueries: vi.fn(),
      listSavedCharts: vi.fn(),
      listRelationships: vi.fn(),
      listAskConversations: vi.fn(),
      listLlmModels: vi.fn(),
      duckDbCapabilities: vi.fn(),
      health: vi.fn(),
      getJob: vi.fn(),
      refreshProfile: vi.fn(),
      cancelJob: vi.fn(),
    },
  }
})

function renderApp() {
  return render(<App />)
}

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    appQueryClient.clear()
    useUiStore.setState({
      activeDatasetId: null,
      columnSearch: '',
      semanticFilter: 'all',
      columnQualityFilter: 'all',
      selectedColumn: null,
      columnDrawerOpen: false,
    })
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
    vi.mocked(api.fetchDatasetProfileOnce).mockResolvedValue(mkProfile())
    vi.mocked(api.getSample).mockResolvedValue({
      page: 1,
      page_size: 100,
      row_count: 0,
      total_rows: 0,
      columns: [],
      rows: [],
    })
    vi.mocked(api.runQuery).mockResolvedValue({
      columns: [],
      rows: [],
      row_count: 0,
      error: null,
      truncated: false,
    })
    vi.mocked(api.getProfileHistory).mockResolvedValue([])
    vi.mocked(api.listSavedQueries).mockResolvedValue([])
    vi.mocked(api.listSavedCharts).mockResolvedValue([])
    vi.mocked(api.listRelationships).mockResolvedValue({ relationships: [], pending_dataset_ids: [] })
    vi.mocked(api.listAskConversations).mockResolvedValue([])
    vi.mocked(api.listLlmModels).mockResolvedValue({
      default_model: 'qwen3:4b',
      models: [{ name: 'qwen3:4b', modified_at: null, size: null }],
      reachable: true,
      detail: null,
    })
    vi.mocked(api.duckDbCapabilities).mockResolvedValue({
      local_open_enabled: true,
      upload_soft_max_bytes: 512,
      inspect_include_row_counts_default: false,
      native_pick_enabled: true,
      view_import_enabled: true,
    })
    vi.mocked(api.health).mockResolvedValue({
      status: 'ok',
      llm: { reachable: true, model: 'qwen3:4b', detail: null },
    })
    vi.mocked(api.uploadDatasets).mockResolvedValue([])
  })

  it('wraps routed pages in a route transition container', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByTestId('route-page-transition')).toBeInTheDocument())
  })

  it('redirects a root dataset URL to a populated Overview without losing selection', async () => {
    window.history.replaceState({}, '', '/?ds=ds_001')
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Overview' }, { timeout: 5_000 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/overview')
    expect(window.location.search).toContain('ds=ds_001')
  })

  it('resets main scroll position when switching primary tabs', async () => {
    const user = userEvent.setup()
    renderApp()
    await waitFor(() => expect(useUiStore.getState().activeDatasetId).toBe('ds_001'))
    await screen.findByRole('heading', { name: 'Overview' }, { timeout: 5_000 })
    const main = screen.getByTestId('main-scroll-region')
    main.scrollTop = 200
    await user.click(screen.getByRole('link', { name: /SQL/i }))
    await screen.findByRole('button', { name: 'Run query' }, { timeout: 5_000 })
    expect(main.scrollTop).toBe(0)
  })

  it('auto-selects first dataset and navigates', async () => {
    const user = userEvent.setup()
    renderApp()
    await waitFor(() => expect(useUiStore.getState().activeDatasetId).toBe('ds_001'))
    await screen.findByRole('heading', { name: 'Overview' }, { timeout: 5_000 })
    expect(screen.getByRole('link', { name: /Columns/i })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /SQL/i }))
    await screen.findByRole('button', { name: 'Run query' }, { timeout: 5_000 })

    await user.click(screen.getByRole('link', { name: /Columns/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/Column name/)).toBeInTheDocument(), {
      timeout: 5_000,
    })

    await user.click(screen.getByRole('link', { name: /Charts/i }))
    await waitFor(() => expect(screen.getByLabelText('Chart type')).toBeInTheDocument(), {
      timeout: 5_000,
    })

    await user.click(screen.getByRole('link', { name: /Ask/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/plain language/i)).toBeInTheDocument(), {
      timeout: 5_000,
    })
  })

  it('navigates to Charts from the command palette', async () => {
    const user = userEvent.setup()
    renderApp()
    await waitFor(() => expect(useUiStore.getState().activeDatasetId).toBe('ds_001'))

    await user.click(screen.getByRole('button', { name: /Search/i }))
    await user.click(screen.getByRole('option', { name: /Charts/i }))

    await waitFor(() => expect(screen.getByLabelText('Chart type')).toBeInTheDocument(), {
      timeout: 5_000,
    })
  })

  it('shows loading skeletons while datasets are loading', () => {
    vi.mocked(api.listDatasets).mockImplementation(() => new Promise(() => {}))
    renderApp()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('shows the empty workspace hero when there are no datasets', async () => {
    vi.mocked(api.listDatasets).mockResolvedValue([])
    renderApp()
    await waitFor(() => expect(screen.getByText(/Welcome to Data Control Center/i)).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /Drop files here or click to choose files/i })).toHaveLength(1)
  })
})

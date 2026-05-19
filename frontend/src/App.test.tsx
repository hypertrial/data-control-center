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
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock('@/api/client', () => ({
  api: {
    listDatasets: vi.fn(),
    uploadDatasets: vi.fn(),
    getProfile: vi.fn(), fetchDatasetProfile: vi.fn(),
    getQuality: vi.fn(),
    getSample: vi.fn(),
    runQuery: vi.fn(),
    askAgent: vi.fn(),
    getProfileHistory: vi.fn(),
    getProfileDiff: vi.fn(),
    listSavedQueries: vi.fn(),
    listAskConversations: vi.fn(),
  },
}))

function renderApp() {
  return render(<App />)
}

describe('App', () => {
  beforeEach(() => {
    appQueryClient.clear()
    useUiStore.setState({
      activeDatasetId: null,
      columnSearch: '',
      semanticFilter: 'all',
      qualitySeverityFilter: 'all',
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
    vi.mocked(api.fetchDatasetProfile).mockResolvedValue(mkProfile())
    vi.mocked(api.getQuality).mockResolvedValue([])
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
    vi.mocked(api.askAgent).mockResolvedValue({
      model: 'qwen3:4b',
      answer: 'Mock answer',
    })
    vi.mocked(api.getProfileHistory).mockResolvedValue([])
    vi.mocked(api.listSavedQueries).mockResolvedValue([])
    vi.mocked(api.listAskConversations).mockResolvedValue([])
    vi.mocked(api.uploadDatasets).mockResolvedValue([])
  })

  it('auto-selects first dataset and navigates', async () => {
    const user = userEvent.setup()
    renderApp()
    await waitFor(() => expect(useUiStore.getState().activeDatasetId).toBe('ds_001'))
    expect(screen.getByRole('link', { name: /Overview/i })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /SQL/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run query' })).toBeInTheDocument())

    await user.click(screen.getByRole('link', { name: /Columns/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/Column name/)).toBeInTheDocument())

    await user.click(screen.getByRole('link', { name: /Ask/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/plain language/i)).toBeInTheDocument())
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
    expect(screen.getAllByRole('button', { name: /Drop files here or click to choose files/i }).length).toBeGreaterThan(0)
  })
})

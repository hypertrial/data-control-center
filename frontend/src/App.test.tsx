import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import App from '@/App'
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
    getProfile: vi.fn(),
    getQuality: vi.fn(),
    getSample: vi.fn(),
    runQuery: vi.fn(),
  },
}))

function renderApp() {
  return render(<App />)
}

describe('App', () => {
  beforeEach(() => {
    vi.mocked(api.listDatasets).mockResolvedValue([
      {
        dataset_id: 'ds_001',
        name: 'a.csv',
        source_path: '/p',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 1,
      },
    ])
    vi.mocked(api.getProfile).mockResolvedValue(mkProfile())
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
    await waitFor(() => expect(screen.getByPlaceholderText(/Filter by column name/)).toBeInTheDocument())
  })
})

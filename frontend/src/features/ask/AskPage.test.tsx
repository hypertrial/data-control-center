import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AskPage } from '@/features/ask/AskPage'
import { useUiStore } from '@/store/uiStore'

const h = vi.hoisted(() => ({
  askAgent: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: { ...mod.api, askAgent: h.askAgent },
  }
})

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

describe('AskPage', () => {
  beforeEach(() => {
    h.askAgent.mockReset()
  })

  it('disables ask when question empty', () => {
    wrap(<AskPage />)
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('shows active dataset in scope hint', () => {
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<AskPage />)
    expect(screen.getByText(/ds_001/)).toBeInTheDocument()
  })

  it('submits and renders answer and opens SQL via store', async () => {
    const user = userEvent.setup()
    h.askAgent.mockResolvedValue({
      answer: 'There are **2** rows.',
      sql: 'SELECT COUNT(*) AS n FROM t',
      explanation: 'Counted rows.',
      model: 'qwen3:8b',
      query_result: {
        columns: [{ name: 'n', type: null }],
        rows: [{ n: 2 }],
        row_count: 1,
        truncated: false,
        error: null,
      },
    })
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'How many rows?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByText(/There are/)).toBeInTheDocument())
    expect(h.askAgent).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'How many rows?' }),
    )
    await user.click(screen.getByRole('button', { name: 'Open in SQL' }))
    expect(useUiStore.getState().pendingQuery).toBe('SELECT COUNT(*) AS n FROM t')
  })

  it('shows banner for API result error', async () => {
    const user = userEvent.setup()
    h.askAgent.mockResolvedValue({
      model: 'qwen3:8b',
      error: 'Could not reach Ollama',
    })
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'x')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByText(/Ollama/)).toBeInTheDocument())
  })

  it('shows SQL block without explanation', async () => {
    const user = userEvent.setup()
    h.askAgent.mockResolvedValue({
      answer: 'Done.',
      sql: 'SELECT 1',
      model: 'm',
    })
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'q')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByText('SELECT 1')).toBeInTheDocument())
    expect(screen.queryByText(/Model note/i)).not.toBeInTheDocument()
  })

  it('shows query_result error banner', async () => {
    const user = userEvent.setup()
    h.askAgent.mockResolvedValue({
      model: 'm',
      answer: 'Partial.',
      sql: 'SELECT bad',
      query_result: {
        columns: [],
        rows: [],
        row_count: 0,
        truncated: false,
        error: 'Binder error',
      },
    })
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'q')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByText(/Binder error/)).toBeInTheDocument())
  })
})

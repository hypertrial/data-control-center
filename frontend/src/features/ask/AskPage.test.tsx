import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AskPage } from '@/features/ask/AskPage'
import { useUiStore } from '@/store/uiStore'

const h = vi.hoisted(() => ({
  askAgentStream: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    askAgentStream: h.askAgentStream,
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

function mockStream(events: Array<{ type: string; data?: unknown }>) {
  h.askAgentStream.mockImplementation(async (_body, onEvent) => {
    for (const ev of events) {
      onEvent(ev as never)
    }
  })
}

describe('AskPage', () => {
  beforeEach(() => {
    h.askAgentStream.mockReset()
  })

  it('disables ask when question empty', () => {
    wrap(<AskPage />)
    expect(screen.getByRole('button', { name: /Ask \(stream\)/ })).toBeDisabled()
  })

  it('shows active dataset in scope hint', () => {
    useUiStore.setState({ activeDatasetId: 'ds_001' })
    wrap(<AskPage />)
    expect(screen.getByText(/ds_001/)).toBeInTheDocument()
  })

  it('submits and renders answer and opens SQL via store', async () => {
    const user = userEvent.setup()
    mockStream([
      { type: 'meta', data: { model: 'qwen3:4b' } },
      {
        type: 'sql',
        data: { sql: 'SELECT COUNT(*) AS n FROM t', explanation: 'Counted rows.' },
      },
      {
        type: 'query_result',
        data: {
          columns: [{ name: 'n', type: 'INTEGER' }],
          rows: [{ n: 2 }],
          row_count: 1,
          truncated: false,
          error: null,
        },
      },
      { type: 'answer', data: { answer: 'There are **2** rows.' } },
      { type: 'done', data: {} },
    ])
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'How many rows?')
    await user.click(screen.getByRole('button', { name: /Ask \(stream\)/i }))
    await waitFor(() => expect(screen.getByText(/There are/)).toBeInTheDocument())
    expect(h.askAgentStream).toHaveBeenCalled()
    const arg = h.askAgentStream.mock.calls[0]![0] as { question: string }
    expect(arg.question).toBe('How many rows?')
    await user.click(screen.getByRole('button', { name: 'Open in SQL' }))
    expect(useUiStore.getState().pendingQuery).toBe('SELECT COUNT(*) AS n FROM t')
  })

  it('submits question on Meta+Enter from textarea', async () => {
    mockStream([
      { type: 'meta', data: { model: 'm' } },
      { type: 'answer', data: { answer: 'ok' } },
      { type: 'done', data: {} },
    ])
    wrap(<AskPage />)
    const ta = screen.getByPlaceholderText(/plain language/i)
    fireEvent.change(ta, { target: { value: 'Why?' } })
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true, bubbles: true })
    await waitFor(() => expect(h.askAgentStream).toHaveBeenCalled())
    const body = h.askAgentStream.mock.calls[0]![0] as { question: string }
    expect(body.question).toBe('Why?')
  })

  it('submits question on Ctrl+Enter from textarea', async () => {
    mockStream([
      { type: 'meta', data: { model: 'm' } },
      { type: 'answer', data: { answer: 'ok' } },
      { type: 'done', data: {} },
    ])
    wrap(<AskPage />)
    const ta = screen.getByPlaceholderText(/plain language/i)
    fireEvent.change(ta, { target: { value: 'Why?' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true, bubbles: true })
    await waitFor(() => expect(h.askAgentStream).toHaveBeenCalled())
  })

  it('shows banner for stream error event', async () => {
    const user = userEvent.setup()
    mockStream([{ type: 'error', data: { message: 'Could not reach Ollama' } }, { type: 'done', data: {} }])
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'x')
    await user.click(screen.getByRole('button', { name: /Ask \(stream\)/i }))
    await waitFor(() => expect(screen.getByText(/Ollama/)).toBeInTheDocument())
  })

  it('shows SQL block without explanation', async () => {
    const user = userEvent.setup()
    mockStream([
      { type: 'meta', data: { model: 'm' } },
      { type: 'sql', data: { sql: 'SELECT 1', explanation: null } },
      { type: 'answer', data: { answer: 'Done.' } },
      { type: 'done', data: {} },
    ])
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'q')
    await user.click(screen.getByRole('button', { name: /Ask \(stream\)/i }))
    await waitFor(() => expect(document.body.textContent).toContain('SELECT 1'))
    expect(screen.queryByText(/Model note/i)).not.toBeInTheDocument()
  })

  it('shows query_result error banner', async () => {
    const user = userEvent.setup()
    mockStream([
      { type: 'meta', data: { model: 'm' } },
      { type: 'sql', data: { sql: 'SELECT bad' } },
      {
        type: 'query_result',
        data: {
          columns: [],
          rows: [],
          row_count: 0,
          truncated: false,
          error: 'Binder error',
        },
      },
      { type: 'answer', data: { answer: 'Partial.' } },
      { type: 'done', data: {} },
    ])
    wrap(<AskPage />)
    await user.type(screen.getByPlaceholderText(/plain language/i), 'q')
    await user.click(screen.getByRole('button', { name: /Ask \(stream\)/i }))
    await waitFor(() => expect(screen.getByText(/Binder error/)).toBeInTheDocument())
  })
})

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AskComposer } from '@/features/ask/AskComposer'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listDatasets: vi.fn(),
      listLlmModels: vi.fn(),
    },
  }
})

const mockSend = vi.fn()
const mockStop = vi.fn()

function Harness(props: Partial<React.ComponentProps<typeof AskComposer>>) {
  const [question, setQuestion] = React.useState('')
  return (
    <AskComposer
      busy={false}
      question={question}
      onQuestionChange={setQuestion}
      onSend={mockSend}
      onStop={mockStop}
      recallQuestion={null}
      {...props}
    />
  )
}

function renderHarness(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('AskComposer', () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockStop.mockReset()
    localStorage.clear()
    vi.mocked(api.listDatasets).mockResolvedValue([
      {
        dataset_id: 'ds_a',
        name: 'a.csv',
        view_name: 'a',
        source_path: '/p',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 1,
      },
      {
        dataset_id: 'ds_b',
        name: 'b.csv',
        view_name: 'b',
        source_path: '/p2',
        format: 'csv',
        row_count: 1,
        column_count: 1,
        file_size_bytes: 1,
      },
    ])
    vi.mocked(api.listLlmModels).mockResolvedValue({
      default_model: 'qwen3:4b',
      models: [
        { name: 'qwen3:4b', modified_at: null, size: null },
        { name: 'llama3.2:3b', modified_at: null, size: null },
      ],
      reachable: true,
      detail: null,
    })
  })

  it('sends on Meta+Enter with scoped dataset_ids (one dataset toggled off)', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Options' }))
    const bCheckbox = await screen.findByRole('checkbox', { name: /b\.csv/i })
    await user.click(bCheckbox)
    fireEvent.change(screen.getByPlaceholderText(/plain language/i), { target: { value: 'Hello' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/plain language/i), {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
    })
    await waitFor(() => expect(mockSend).toHaveBeenCalled())
    const payload = mockSend.mock.calls[0]![0] as {
      question: string
      datasetIds: string[] | null
      model: string | null
    }
    expect(payload.question).toBe('Hello')
    expect(payload.datasetIds).toEqual(['ds_a'])
    expect(payload.model).toBe('qwen3:4b')
  })

  it('opens the popover from the model chip and keeps the model controls usable', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: /qwen3:4b/i }))

    const modelSelect = screen.getByRole('combobox', { name: /Ollama model/i })
    expect(modelSelect).toBeInTheDocument()
    expect(modelSelect.closest('section')).toHaveAttribute('data-focus', 'true')
    expect(screen.getByRole('button', { name: /qwen3:4b/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument()
  })

  it('opens the rows section from the rows chip', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: /200 rows/i }))

    const rowsInput = screen.getByLabelText(/Max rows in preview/i)
    expect(rowsInput).toBeInTheDocument()
    expect(rowsInput.closest('section')).toHaveAttribute('data-focus', 'true')
  })

  it('opens the dataset scope section from the scope chip', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'All datasets' }))

    const allCheckbox = screen.getByRole('checkbox', { name: /All datasets/i })
    expect(allCheckbox).toBeInTheDocument()
    expect(allCheckbox.closest('section')).toHaveAttribute('data-focus', 'true')
  })

  it('opens the full options popover from the options button', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Options' }))

    expect(screen.getByRole('combobox', { name: /Ollama model/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Max rows in preview/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /All datasets/i })).toBeInTheDocument()
  })

  it('shows dataset names in scope options, not raw ids as chips', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Options' }))
    expect(screen.getByText('a.csv')).toBeInTheDocument()
    expect(screen.getByText('b.csv')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ds_a' })).not.toBeInTheDocument()
  })

  it('calls onStop on Escape while busy and shows Stop only when busy', async () => {
    const { rerender } = renderHarness(
      <AskComposer
        busy={false}
        question="x"
        onQuestionChange={() => {}}
        onSend={mockSend}
        onStop={mockStop}
        recallQuestion={null}
      />,
    )
    expect(screen.queryByRole('button', { name: /Stop \(Esc\)/ })).not.toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <AskComposer
            busy
            question="x"
            onQuestionChange={() => {}}
            onSend={mockSend}
            onStop={mockStop}
            recallQuestion={null}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    fireEvent.keyDown(screen.getByPlaceholderText(/plain language/i), {
      key: 'Escape',
      bubbles: true,
    })
    expect(mockStop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Stop \(Esc\)/ })).toBeInTheDocument()
  })

  it('recalls last question on ArrowUp when empty', async () => {
    renderHarness(<Harness recallQuestion="Previous?" />)
    const ta = screen.getByPlaceholderText(/plain language/i)
    fireEvent.keyDown(ta, { key: 'ArrowUp', bubbles: true })
    await waitFor(() => expect(ta).toHaveValue('Previous?'))
  })

  it('uses null datasetIds when all datasets in scope', async () => {
    renderHarness(<Harness />)
    fireEvent.change(screen.getByPlaceholderText(/plain language/i), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: /Ask \(stream\)/ }))
    await waitFor(() => expect(mockSend).toHaveBeenCalled())
    expect(mockSend.mock.calls[0]![0].datasetIds).toBeNull()
  })

  it('lists installed Ollama models in the Options popover select', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Options' }))
    const modelSelect = screen.getByRole('combobox', { name: /Ollama model/i })
    expect(modelSelect).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'qwen3:4b' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'llama3.2:3b' })).toBeInTheDocument()
  })

  it('sends the selected Ollama model via select and saves it locally', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Options' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /Ollama model/i }), 'llama3.2:3b')
    fireEvent.change(screen.getByPlaceholderText(/plain language/i), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: /Ask \(stream\)/ }))
    await waitFor(() => expect(mockSend).toHaveBeenCalled())
    expect(mockSend.mock.calls[0]![0].model).toBe('llama3.2:3b')
    expect(localStorage.getItem('dcc-ask-llm-model')).toBe('llama3.2:3b')
  })

  it('reuses a saved model when it is still installed', async () => {
    localStorage.setItem('dcc-ask-llm-model', 'llama3.2:3b')
    renderHarness(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: /llama3\.2:3b/i })).toBeInTheDocument())
  })

  it('falls back to the default model when a saved model is stale', async () => {
    localStorage.setItem('dcc-ask-llm-model', 'missing:model')
    renderHarness(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: /qwen3:4b/i })).toBeInTheDocument())
  })

  it('keeps explicit scope when all-datasets master is toggled off', async () => {
    const user = userEvent.setup()
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Options' }))
    const allCheckbox = screen.getByRole('checkbox', { name: /All datasets/i })
    expect(allCheckbox).toBeChecked()
    await user.click(allCheckbox)
    expect(allCheckbox).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /a\.csv/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /b\.csv/i })).toBeChecked()
  })

  it('allows Ask with the configured default when model listing is unreachable', async () => {
    vi.mocked(api.listLlmModels).mockResolvedValue({
      default_model: 'qwen3:4b',
      models: [],
      reachable: false,
      detail: 'Could not reach local LLM endpoint.',
    })
    renderHarness(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: /qwen3:4b/i })).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/plain language/i), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: /Ask \(stream\)/ }))
    await waitFor(() => expect(mockSend).toHaveBeenCalled())
    expect(mockSend.mock.calls[0]![0].model).toBe('qwen3:4b')
  })

  it('shows Ollama reachability detail in Options when model listing fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listLlmModels).mockResolvedValue({
      default_model: 'qwen3:4b',
      models: [],
      reachable: false,
      detail: 'Could not reach local LLM endpoint.',
    })
    renderHarness(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Options' }))
    expect(screen.getByText('Could not reach local LLM endpoint.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Ollama model/i })).toHaveValue('qwen3:4b')
  })
})

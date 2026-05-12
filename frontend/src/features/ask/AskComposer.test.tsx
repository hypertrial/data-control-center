import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  })

  it('sends on Meta+Enter with scoped dataset_ids (one dataset toggled off)', async () => {
    renderHarness(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'ds_b' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ds_b' }))
    fireEvent.change(screen.getByPlaceholderText(/plain language/i), { target: { value: 'Hello' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/plain language/i), {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
    })
    await waitFor(() => expect(mockSend).toHaveBeenCalled())
    const payload = mockSend.mock.calls[0]![0] as { question: string; datasetIds: string[] | null }
    expect(payload.question).toBe('Hello')
    expect(payload.datasetIds).toEqual(['ds_a'])
  })

  it('calls onStop on Escape while busy', async () => {
    renderHarness(
      <AskComposer
        busy
        question="x"
        onQuestionChange={() => {}}
        onSend={mockSend}
        onStop={mockStop}
        recallQuestion={null}
      />,
    )
    fireEvent.keyDown(screen.getByPlaceholderText(/plain language/i), {
      key: 'Escape',
      bubbles: true,
    })
    expect(mockStop).toHaveBeenCalled()
  })

  it('recalls last question on ArrowUp when empty', async () => {
    renderHarness(<Harness recallQuestion="Previous?" />)
    const ta = screen.getByPlaceholderText(/plain language/i)
    fireEvent.keyDown(ta, { key: 'ArrowUp', bubbles: true })
    await waitFor(() => expect(ta).toHaveValue('Previous?'))
  })

  it('uses null datasetIds when all datasets in scope', async () => {
    renderHarness(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'All datasets' })).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/plain language/i), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: /Ask \(stream\)/ }))
    await waitFor(() => expect(mockSend).toHaveBeenCalled())
    expect(mockSend.mock.calls[0]![0].datasetIds).toBeNull()
  })
})

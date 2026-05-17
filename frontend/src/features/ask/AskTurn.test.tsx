import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AskTurnCard, StreamingAskCard } from '@/features/ask/AskTurn'
import type { AskTurn } from '@/api/types'

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <pre>{value}</pre>,
}))

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: toastMock,
}))

describe('AskTurn', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
  })

  it('renders a persisted turn with SQL, result, markdown answer, retry, and model info', async () => {
    const user = userEvent.setup()
    const onOpenInSql = vi.fn()
    const onRetry = vi.fn()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const turn: AskTurn = {
      turn_id: 't1',
      conversation_id: 'c1',
      seq: 1,
      question: 'Why did revenue drop?',
      sql: 'SELECT * FROM sales LIMIT 25',
      answer: '**Because** returns spiked.',
      error: 'retry me',
      model: 'qwen',
      elapsed_ms: 123,
      attempts: [{ sql: 'SELECT * FROM sales LIMIT 25', error: 'none', attempt: 4 }],
      query_result: {
        columns: [{ name: 'region', type: 'VARCHAR' }],
        rows: [{ region: 'West' }],
        row_count: 1,
        truncated: false,
        error: null,
      },
      created_at: 'now',
    }

    render(<AskTurnCard turn={turn} onOpenInSql={onOpenInSql} onRetry={onRetry} />)

    expect(screen.getByText('Why did revenue drop?')).toBeInTheDocument()
    expect(screen.getByText('Because')).toBeInTheDocument()
    expect(screen.getByText('Model: qwen')).toBeInTheDocument()
    expect(screen.getByText('West')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open in SQL' }))
    expect(onOpenInSql).toHaveBeenCalledWith('SELECT * FROM sales LIMIT 25')

    await user.click(screen.getByRole('button', { name: 'Open without LIMIT' }))
    expect(onOpenInSql).toHaveBeenCalledWith('SELECT * FROM sales')

    await user.click(screen.getAllByRole('button', { name: 'Copy' })[0]!)
    expect(write).toHaveBeenCalledWith('SELECT * FROM sales LIMIT 25')
    expect(toastMock.success).toHaveBeenCalledWith('SQL copied')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledWith('Why did revenue drop?')
    write.mockRestore()
  })

  it('renders query result errors and no-op timeline when there are no attempts', () => {
    render(
      <AskTurnCard
        turn={{
          turn_id: 't2',
          conversation_id: 'c1',
          seq: 2,
          question: 'Any issue?',
          attempts: [],
          query_result: { columns: [], rows: [], row_count: 0, truncated: false, error: 'bad result' },
          created_at: 'now',
        }}
        onOpenInSql={() => {}}
      />,
    )

    expect(screen.getByText('bad result')).toBeInTheDocument()
    expect(screen.queryByText('Generated SQL')).not.toBeInTheDocument()
  })

  it('renders streaming card states including explanation, preview answer, retry gating, and query error', async () => {
    const user = userEvent.setup()
    const onOpenInSql = vi.fn()
    const onRetry = vi.fn()

    const { rerender } = render(
      <StreamingAskCard
        question="Show revenue trend"
        busy
        stages={[{ name: 'context', at: 0 }]}
        sqlAttempts={[{ sql: 'SELECT 1', error: 'oops', attempt: 1 }]}
        sql="SELECT 1 LIMIT 10"
        explanation="I am drafting SQL."
        queryResult={null}
        answer={null}
        error="stream failed"
        streamingPreview="partial answer"
        model="qwen"
        totalMs={55}
        onOpenInSql={onOpenInSql}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('I am drafting SQL.')).toBeInTheDocument()
    expect(screen.getByText('partial answer')).toBeInTheDocument()
    expect(screen.getByText('stream failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open in SQL' }))
    expect(onOpenInSql).toHaveBeenCalledWith('SELECT 1 LIMIT 10')

    rerender(
      <StreamingAskCard
        question="Show revenue trend"
        busy={false}
        stages={[]}
        sqlAttempts={[]}
        sql={null}
        explanation={null}
        queryResult={{ columns: [], rows: [], row_count: 0, truncated: false, error: 'query broke' }}
        answer="final answer"
        error="stream failed"
        streamingPreview=""
        model={null}
        totalMs={12}
        onOpenInSql={onOpenInSql}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('query broke')).toBeInTheDocument()
    expect(screen.getByText('final answer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledWith('Show revenue trend')
  })
})

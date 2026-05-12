import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AskStageTimeline } from '@/features/ask/AskStageTimeline'
import type { AskSqlAttempt, AskStageEntry } from '@/hooks/useAskStream'

describe('AskStageTimeline', () => {
  it('shows stage pills and failed attempts disclosure', async () => {
    const user = userEvent.setup()
    const stages: AskStageEntry[] = [
      { name: 'context', at: 1 },
      { name: 'draft_sql', at: 2, attempt: 1 },
      { name: 'execute', at: 3 },
      { name: 'summarize', at: 4 },
    ]
    const sqlAttempts: AskSqlAttempt[] = [
      { sql: 'SELECT broken', error: 'Syntax error near x', attempt: 1 },
      { sql: 'SELECT ok', error: 'empty', attempt: 2 },
    ]
    render(
      <AskStageTimeline stages={stages} sqlAttempts={sqlAttempts} totalMs={42} busy={false} />,
    )
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('42 ms')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Attempts \(2\)/ }))
    expect(screen.getByText(/Syntax error near x/)).toBeInTheDocument()
  })
})

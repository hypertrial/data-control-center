import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AskTurn } from '@/api/types'
import { AskThread } from '@/features/ask/AskThread'
import type { AskCallState } from '@/hooks/useAskStream'

vi.mock('@/features/ask/AskTurn', () => ({
  AskTurnCard: ({ turn }: { turn: AskTurn }) => <div data-testid={`turn-${turn.turn_id}`}>card</div>,
  StreamingAskCard: () => <div data-testid="streaming-card">streaming</div>,
}))

function turn(id: string, seq = 1): AskTurn {
  return {
    turn_id: id,
    conversation_id: 'c1',
    seq,
    question: 'q',
    attempts: [],
    created_at: 't',
  }
}

const baseStream: AskCallState = {
  stages: [],
  sqlAttempts: [],
  sql: null,
  explanation: null,
  queryResult: null,
  answer: null,
  error: null,
  model: null,
  totalMs: null,
  turnId: null,
  conversationId: null,
  seq: null,
  streamingAnswerPreview: '',
  summarizing: false,
}

function mountScrollMocks(el: HTMLElement, heights: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    value: heights.scrollHeight,
  })
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    value: heights.clientHeight,
  })
}

describe('AskThread', () => {
  it('scrolls smoothly when a new streaming question is sent', async () => {
    const scrollTo = vi.fn()
    const { rerender } = render(
      <AskThread
        conversationId="c1"
        turns={[]}
        streamingQuestion={null}
        streaming={null}
        busy={false}
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )
    const el = screen.getByTestId('ask-thread-scroll')
    el.scrollTo = scrollTo
    mountScrollMocks(el, { scrollHeight: 400, clientHeight: 300 })

    rerender(
      <AskThread
        conversationId="c1"
        turns={[]}
        streamingQuestion="Hello?"
        streaming={{ ...baseStream, stages: [{ name: 'context', at: 0 }] }}
        busy
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' })
    })
  })

  it('shows Jump to latest when content grows while user is scrolled up', async () => {
    const { rerender } = render(
      <AskThread
        conversationId="c1"
        turns={[turn('t1')]}
        streamingQuestion={null}
        streaming={null}
        busy={false}
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )
    const el = screen.getByTestId('ask-thread-scroll') as HTMLDivElement
    mountScrollMocks(el, { scrollHeight: 1000, clientHeight: 300 })
    el.scrollTop = 500
    fireEvent.scroll(el)

    mountScrollMocks(el, { scrollHeight: 1200, clientHeight: 300 })
    rerender(
      <AskThread
        conversationId="c1"
        turns={[turn('t1'), turn('t2', 2)]}
        streamingQuestion={null}
        streaming={null}
        busy={false}
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )

    expect(await screen.findByRole('button', { name: /Jump to latest message/i })).toBeInTheDocument()
  })

  it('Jump to latest scrolls to bottom and hides the button', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.fn()
    const { rerender } = render(
      <AskThread
        conversationId="c1"
        turns={[turn('t1')]}
        streamingQuestion={null}
        streaming={null}
        busy={false}
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )
    const el = screen.getByTestId('ask-thread-scroll') as HTMLDivElement
    el.scrollTo = scrollTo
    mountScrollMocks(el, { scrollHeight: 1000, clientHeight: 300 })
    el.scrollTop = 500
    fireEvent.scroll(el)

    mountScrollMocks(el, { scrollHeight: 1300, clientHeight: 300 })
    rerender(
      <AskThread
        conversationId="c1"
        turns={[turn('t1'), turn('t2', 2)]}
        streamingQuestion={null}
        streaming={null}
        busy={false}
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )

    const jump = await screen.findByRole('button', { name: /Jump to latest message/i })
    await user.click(jump)

    expect(scrollTo).toHaveBeenCalledWith({ top: 1300, behavior: 'smooth' })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Jump to latest message/i })).not.toBeInTheDocument(),
    )
  })

  it('pins to bottom when near bottom during streaming updates', () => {
    const streaming: AskCallState = {
      ...baseStream,
      stages: [{ name: 'context', at: 0 }],
    }
    const { rerender } = render(
      <AskThread
        conversationId="c1"
        turns={[]}
        streamingQuestion="Q"
        streaming={streaming}
        busy
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )
    const el = screen.getByTestId('ask-thread-scroll') as HTMLDivElement
    mountScrollMocks(el, { scrollHeight: 500, clientHeight: 300 })
    el.scrollTop = 180 // 500 - 180 - 300 = 20 <= 96 -> near bottom

    const next: AskCallState = {
      ...streaming,
      sqlAttempts: [{ sql: 'SELECT 1', error: 'x', attempt: 1 }],
    }
    mountScrollMocks(el, { scrollHeight: 600, clientHeight: 300 })
    rerender(
      <AskThread
        conversationId="c1"
        turns={[]}
        streamingQuestion="Q"
        streaming={next}
        busy
        onOpenInSql={() => {}}
        onRetry={() => {}}
      />,
    )

    expect(el.scrollTop).toBe(Math.max(0, el.scrollHeight - el.clientHeight))
  })
})

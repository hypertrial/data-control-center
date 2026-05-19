import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AskContextBar } from '@/features/ask/AskContextBar'

describe('AskContextBar', () => {
  it('returns null when hidden', () => {
    const { container } = render(
      <AskContextBar
        hidden
        modelLabel="m"
        maxRows={200}
        scope="all"
        datasetCount={1}
        onOpenSettings={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens settings sections from chips', async () => {
    const user = userEvent.setup()
    const onOpenSettings = vi.fn()
    render(
      <AskContextBar
        modelLabel="qwen3:4b"
        maxRows={100}
        scope="all"
        datasetCount={2}
        onOpenSettings={onOpenSettings}
        showChatsButton
        onOpenChats={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'qwen3:4b' }))
    expect(onOpenSettings).toHaveBeenCalledWith('model')
    await user.click(screen.getByRole('button', { name: '100 rows' }))
    expect(onOpenSettings).toHaveBeenCalledWith('rows')
  })
})

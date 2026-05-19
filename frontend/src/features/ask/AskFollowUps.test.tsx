import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AskFollowUps } from '@/features/ask/AskFollowUps'

describe('AskFollowUps', () => {
  it('renders nothing when prompts are empty', () => {
    const { container } = render(<AskFollowUps prompts={[]} onPick={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders chips and calls onPick', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<AskFollowUps prompts={['Follow up A']} onPick={onPick} />)
    await user.click(screen.getByRole('button', { name: 'Follow up A' }))
    expect(onPick).toHaveBeenCalledWith('Follow up A')
  })
})

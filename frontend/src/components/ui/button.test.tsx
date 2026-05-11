import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders variants and handles click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(
      <Button variant="default" onClick={onClick}>
        go
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'go' }))
    expect(onClick).toHaveBeenCalled()

    rerender(
      <Button variant="ghost" size="sm" disabled>
        g2
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'g2' })).toBeDisabled()

    rerender(
      <Button variant="outline" size="icon" aria-label="icon-btn">
        I
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'icon-btn' })).toBeInTheDocument()
  })
})

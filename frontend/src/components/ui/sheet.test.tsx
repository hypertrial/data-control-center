import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from '@/components/ui/sheet'

describe('Sheet', () => {
  it('renders when open and closes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <Sheet open={false} onOpenChange={onOpenChange} title="T">
        body
      </Sheet>,
    )
    expect(screen.queryByText('body')).toBeNull()

    rerender(
      <Sheet open onOpenChange={onOpenChange} title="T" className="extra">
        body
      </Sheet>,
    )
    expect(screen.getByText('body')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

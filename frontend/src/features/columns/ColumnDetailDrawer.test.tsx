import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ColumnDetailDrawer } from '@/features/columns/ColumnDetailDrawer'
import { mkColumn } from '@/test/profileFixtures'

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}))

describe('ColumnDetailDrawer', () => {
  it('returns null without column', () => {
    const { container } = render(
      <ColumnDetailDrawer open onOpenChange={vi.fn()} column={null} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders sheet and triggers chart', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const col = mkColumn({
      top_values: [
        { value: 'a', count: 3 },
        { value: null, count: 1 },
      ],
      min_value: null,
      max_value: null,
      unique_count: null,
      cardinality: null,
    })
    render(<ColumnDetailDrawer open onOpenChange={onOpenChange} column={col} />)
    expect(screen.getByText('col_a')).toBeInTheDocument()
    window.dispatchEvent(new Event('resize'))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

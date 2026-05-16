import { MemoryRouter } from 'react-router-dom'
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
      <MemoryRouter>
        <ColumnDetailDrawer open onOpenChange={vi.fn()} column={null} viewName="" />
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('stats tab lists describe metrics', async () => {
    const user = userEvent.setup()
    const col = mkColumn({
      mean_value: '3.5',
      p25_value: '1',
      top_value: 'mode-x',
      top_count: 2,
      top_pct: 40,
    })
    render(
      <MemoryRouter>
        <ColumnDetailDrawer open onOpenChange={vi.fn()} column={col} viewName="metrics" />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Stats' }))
    expect(screen.getByText(/Unique \(sample\)/)).toBeInTheDocument()
    expect(screen.getByText('3.5')).toBeInTheDocument()
    expect(screen.getByText('mode-x')).toBeInTheDocument()
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
    render(
      <MemoryRouter>
        <ColumnDetailDrawer open onOpenChange={onOpenChange} column={col} viewName="metrics" />
      </MemoryRouter>,
    )
    expect(screen.getByText('col_a')).toBeInTheDocument()
    window.dispatchEvent(new Event('resize'))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

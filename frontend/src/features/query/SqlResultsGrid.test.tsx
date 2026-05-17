import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SqlResultsGrid } from '@/features/query/SqlResultsGrid'
import type { QueryResult } from '@/api/types'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: toastMock,
}))

const base: QueryResult = {
  columns: [
    { name: 'x', type: 'INTEGER' },
    { name: 'j', type: 'VARCHAR' },
  ],
  rows: [
    { x: 2, j: null },
    { x: 1, j: { y: 3 } },
  ],
  row_count: 2,
  truncated: true,
  error: null,
}

describe('SqlResultsGrid', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    vi.restoreAllMocks()
  })

  it('renders toolbar, row numbers, NULL for nulls, and object JSON in cells', () => {
    render(<SqlResultsGrid queryResult={base} />)
    expect(screen.getByTestId('sql-results-grid')).toBeInTheDocument()
    expect(screen.getByText(/\(truncated\)/)).toBeInTheDocument()
    expect(screen.getByText('NULL')).toBeInTheDocument()
    expect(screen.getByText('{"y":3}')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('Export CSV copies sorted-visible rows', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<SqlResultsGrid queryResult={base} />)
    await user.click(screen.getByRole('button', { name: /Export CSV/i }))
    expect(write).toHaveBeenCalled()
    const csv = write.mock.calls[0][0] as string
    expect(csv.split('\n').length).toBeGreaterThanOrEqual(3)
    expect(csv).toContain('x,j')
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('CSV copied to clipboard'))
    write.mockRestore()
  })

  it('opens cell detail on double-click for data column', async () => {
    const user = userEvent.setup()
    render(<SqlResultsGrid queryResult={base} />)
    const cells = screen.getAllByText('{"y":3}')
    await user.dblClick(cells[0])
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText(/"y": 3/)).toBeInTheDocument()
  })

  it('shows busy state in toolbar', () => {
    render(<SqlResultsGrid queryResult={base} busy />)
    expect(screen.getByText('Running…')).toBeInTheDocument()
  })

  it('copies selection TSV from keyboard navigation and opens row details with keyboard-safe row-number guard', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const { container } = render(<SqlResultsGrid queryResult={base} />)

    const start = container.querySelector('td[data-row="0"][data-col="1"]') as HTMLElement
    const end = container.querySelector('td[data-row="1"][data-col="2"]') as HTMLElement
    fireEvent.mouseDown(start)
    fireEvent.mouseEnter(end)
    await user.click(screen.getByRole('button', { name: /Copy TSV/i }))

    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(toastMock.success).toHaveBeenCalledWith('Selection copied (TSV)')

    const rowNumberCell = container.querySelector('td[data-row="0"][data-col="0"]') as HTMLElement
    await user.dblClick(rowNumberCell)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    write.mockRestore()
  })

  it('copies JSON and skips large export when confirmation is rejected', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm')

    const first = render(<SqlResultsGrid queryResult={base} />)
    await user.click(screen.getByRole('button', { name: /Copy JSON/i }))
    expect(write).toHaveBeenCalledWith(JSON.stringify(base.rows, null, 2))
    expect(toastMock.success).toHaveBeenCalledWith('Result rows copied as JSON')
    first.unmount()

    const huge: QueryResult = {
      ...base,
      columns: Array.from({ length: 400 }, (_, i) => ({ name: `c${i}`, type: 'INTEGER' })),
      rows: Array.from({ length: 500 }, (_, i) =>
        Object.fromEntries(Array.from({ length: 400 }, (_, j) => [`c${j}`, i + j])),
      ),
      row_count: 500,
      truncated: false,
    }

    confirm.mockReturnValue(false)
    render(<SqlResultsGrid queryResult={huge} />)
    expect(screen.getByText(/large export/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Copy JSON/i }))
    await user.click(screen.getByRole('button', { name: /Export CSV/i }))
    expect(confirm).toHaveBeenCalledTimes(2)
    write.mockRestore()
  })
})

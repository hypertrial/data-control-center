import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AskResultTable } from '@/features/ask/AskResultTable'
import type { QueryResult } from '@/api/types'

const toastMock = vi.hoisted(() => ({ success: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))

const sample: QueryResult = {
  columns: [
    { name: 'id', type: 'INTEGER' },
    { name: 'name', type: 'VARCHAR' },
  ],
  rows: [
    { id: 1, name: 'a,b' },
    { id: 2, name: 'x' },
  ],
  row_count: 2,
  truncated: false,
  error: null,
}

describe('AskResultTable', () => {
  it('opens cell detail on click and exports CSV to clipboard', async () => {
    const user = userEvent.setup()
    toastMock.success.mockReset()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    render(<AskResultTable queryResult={sample} />)

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(write).toHaveBeenCalledWith('id,name\n1,"a,b"\n2,x')
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('CSV copied to clipboard'))

    await user.click(screen.getByText('a,b', { selector: 'td .truncate' }))
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText('a,b')).toBeInTheDocument()

    write.mockRestore()
  })
})

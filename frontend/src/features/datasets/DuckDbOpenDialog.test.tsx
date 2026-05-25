import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { DuckDbOpenDialog } from '@/features/datasets/DuckDbOpenDialog'

const toastMock = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/api/client', () => ({
  api: {
    openLocalDuckDb: vi.fn(),
    pickLocalDuckDb: vi.fn(),
  },
}))

describe('DuckDbOpenDialog', () => {
  beforeEach(() => {
    toastMock.error.mockReset()
    vi.mocked(api.openLocalDuckDb).mockReset()
    vi.mocked(api.pickLocalDuckDb).mockReset()
  })

  it('opens via native pick', async () => {
    const user = userEvent.setup()
    vi.mocked(api.pickLocalDuckDb).mockResolvedValue({
      source_id: 'loc_pick',
      filename: 'picked.duckdb',
      source_kind: 'local',
    })
    const onOpened = vi.fn()
    render(<DuckDbOpenDialog open hint="Too large" onClose={vi.fn()} onOpened={onOpened} />)
    await user.click(screen.getByRole('button', { name: 'Choose file…' }))
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
    expect(onOpened).toHaveBeenCalledWith('loc_pick', 'picked.duckdb')
  })

  it('opens via typed path', async () => {
    const user = userEvent.setup()
    vi.mocked(api.openLocalDuckDb).mockResolvedValue({
      source_id: 'loc_abc',
      filename: 'warehouse.duckdb',
      source_kind: 'local',
    })
    const onOpened = vi.fn()
    render(<DuckDbOpenDialog open onClose={vi.fn()} onOpened={onOpened} />)
    await user.type(screen.getByLabelText(/Absolute path/), '/data/warehouse.duckdb')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() =>
      expect(api.openLocalDuckDb).toHaveBeenCalledWith('/data/warehouse.duckdb'),
    )
    expect(onOpened).toHaveBeenCalledWith('loc_abc', 'warehouse.duckdb')
  })

  it('ignores cancelled native picks', async () => {
    const user = userEvent.setup()
    vi.mocked(api.pickLocalDuckDb).mockRejectedValue(new Error('File selection was cancelled'))
    render(<DuckDbOpenDialog open onClose={vi.fn()} onOpened={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Choose file…' }))
    await waitFor(() => expect(api.pickLocalDuckDb).toHaveBeenCalled())
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('surfaces open-local failures', async () => {
    const user = userEvent.setup()
    vi.mocked(api.openLocalDuckDb).mockRejectedValue(new Error('Path not allowed'))
    render(<DuckDbOpenDialog open onClose={vi.fn()} onOpened={vi.fn()} />)
    await user.type(screen.getByLabelText(/Absolute path/), '/tmp/x.duckdb')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Path not allowed'))
  })

  it('requires a path or file choice', async () => {
    const user = userEvent.setup()
    render(<DuckDbOpenDialog open onClose={vi.fn()} onOpened={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(toastMock.error).toHaveBeenCalledWith('Choose a .duckdb file or enter its absolute path.')
    expect(api.openLocalDuckDb).not.toHaveBeenCalled()
  })
})

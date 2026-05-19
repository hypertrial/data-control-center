import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSqlResultsGrid } from '@/features/query/useSqlResultsGrid'
import type { QueryResult } from '@/api/types'

const toastMock = vi.hoisted(() => ({ success: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))

const base: QueryResult = {
  columns: [
    { name: 'x', type: 'INTEGER' },
    { name: 'j', type: 'VARCHAR' },
  ],
  rows: [
    { x: 2, j: 'a' },
    { x: 1, j: 'b' },
  ],
  row_count: 2,
  truncated: false,
  error: null,
}

describe('useSqlResultsGrid', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
  })

  it('builds table columns including row number', () => {
    const { result } = renderHook(() => useSqlResultsGrid(base))
    const ids = result.current.table.getAllLeafColumns().map((c) => c.id)
    expect(ids).toContain('__rownum__')
    expect(ids).toContain('x')
    expect(ids).toContain('j')
  })

  it('copySelectionTsv copies all rows when no selection', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const { result } = renderHook(() => useSqlResultsGrid(base))
    act(() => {
      result.current.copySelectionTsv()
    })
    expect(write).toHaveBeenCalled()
    const tsv = write.mock.calls[0]?.[0] as string
    expect(tsv).toContain('2\ta')
    expect(toastMock.success).toHaveBeenCalledWith('All rows copied (TSV)')
    write.mockRestore()
  })

  it('openCellDetail sets detail for data column', () => {
    const { result } = renderHook(() => useSqlResultsGrid(base))
    act(() => {
      result.current.openCellDetail(0, 1)
    })
    expect(result.current.cellDetail).toEqual({ title: 'x', body: '2' })
  })
})

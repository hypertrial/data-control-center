import { describe, expect, it } from 'vitest'
import {
  formatCellDetail,
  formatCellDisplay,
  formatCellExport,
  isInSelection,
  isNumericSqlType,
  isNullishCell,
  normalizeSelection,
  queryResultToCsv,
  queryResultToTsv,
} from '@/features/query/queryGridUtils'
import type { QueryResultColumn } from '@/api/types'

const cols: QueryResultColumn[] = [
  { name: 'a', type: 'INTEGER' },
  { name: 'b', type: 'VARCHAR' },
]

describe('queryGridUtils', () => {
  it('isNumericSqlType', () => {
    expect(isNumericSqlType('BIGINT')).toBe(true)
    expect(isNumericSqlType('VARCHAR')).toBe(false)
    expect(isNumericSqlType(null)).toBe(false)
  })

  it('formatCellDisplay shows NULL label for nullish', () => {
    expect(formatCellDisplay(null)).toBe('NULL')
    expect(formatCellDisplay(undefined)).toBe('NULL')
    expect(formatCellDisplay(0)).toBe('0')
  })

  it('formatCellExport uses empty for nullish', () => {
    expect(formatCellExport(null)).toBe('')
    expect(formatCellExport('x')).toBe('x')
  })

  it('formatCellDetail pretty-prints objects', () => {
    expect(formatCellDetail({ y: 2 })).toBe('{\n  "y": 2\n}')
  })

  it('isNullishCell', () => {
    expect(isNullishCell(null)).toBe(true)
    expect(isNullishCell(0)).toBe(false)
  })

  it('normalizeSelection and isInSelection', () => {
    const r = normalizeSelection({ row: 2, col: 0 }, { row: 0, col: 2 })
    expect(r).toEqual({ r0: 0, r1: 2, c0: 0, c1: 2 })
    expect(isInSelection(1, 1, r)).toBe(true)
    expect(isInSelection(3, 1, r)).toBe(false)
  })

  it('queryResultToTsv respects selection rectangle', () => {
    const rows = [
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]
    expect(queryResultToTsv(cols, rows, { r0: 0, r1: 1, c0: 1, c1: 2 })).toBe('1\tx\n2\ty')
    expect(queryResultToTsv(cols, rows, { r0: 1, r1: 1, c0: 0, c1: 2 })).toBe('2\t2\ty')
  })

  it('queryResultToCsv', () => {
    const rows = [
      { a: 1, b: 'a,b' },
      { a: null, b: 'x' },
    ]
    expect(queryResultToCsv(cols, rows)).toBe('a,b\n1,"a,b"\n,x')
  })
})

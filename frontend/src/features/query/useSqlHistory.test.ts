import { describe, expect, it, beforeEach } from 'vitest'
import { loadSqlHistory, saveSqlHistory, SQL_HISTORY_CAP } from '@/features/query/useSqlHistory'

describe('useSqlHistory', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads empty history by default', () => {
    expect(loadSqlHistory()).toEqual([])
  })

  it('saves and loads capped history', () => {
    const entries = Array.from({ length: SQL_HISTORY_CAP + 3 }, (_, i) => `SELECT ${i}`)
    saveSqlHistory(entries)
    expect(loadSqlHistory()).toHaveLength(SQL_HISTORY_CAP)
    expect(loadSqlHistory()[0]).toBe('SELECT 0')
  })
})

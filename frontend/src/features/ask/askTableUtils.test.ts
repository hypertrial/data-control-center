import { describe, expect, it } from 'vitest'
import { isNumericAskCell, stripTrailingLimit } from '@/features/ask/askTableUtils'

describe('askTableUtils', () => {
  it('stripTrailingLimit removes trailing LIMIT', () => {
    expect(stripTrailingLimit('SELECT 1 LIMIT 500')).toBe('SELECT 1')
    expect(stripTrailingLimit('SELECT 1 limit 10')).toBe('SELECT 1')
  })

  it('isNumericAskCell detects numeric SQL types', () => {
    const m = { x: 'DOUBLE', y: 'VARCHAR' }
    expect(isNumericAskCell(m, 'x')).toBe(true)
    expect(isNumericAskCell(m, 'y')).toBe(false)
  })
})

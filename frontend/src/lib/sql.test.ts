import { describe, expect, it } from 'vitest'
import {
  quoteIdent,
  quoteLiteral,
  sqlSelectColumnFromView,
  sqlSelectStarFromView,
  sqlWherePkSample,
} from '@/lib/sql'

describe('sql helpers', () => {
  it('quoteIdent leaves simple names bare', () => {
    expect(quoteIdent('foo')).toBe('foo')
  })

  it('quoteIdent doubles embedded quotes', () => {
    expect(quoteIdent('weird"name')).toBe('"weird""name"')
  })

  it('quoteLiteral escapes strings', () => {
    expect(quoteLiteral("O'Reilly")).toBe("'O''Reilly'")
  })

  it('quoteLiteral numbers and booleans', () => {
    expect(quoteLiteral(42)).toBe('42')
    expect(quoteLiteral(true)).toBe('TRUE')
    expect(quoteLiteral(null)).toBe('NULL')
  })

  it('sqlSelectStarFromView quotes non-identifier views', () => {
    expect(sqlSelectStarFromView('player_ratings', 10)).toContain('player_ratings')
    expect(sqlSelectStarFromView('player_ratings', 10)).toContain('LIMIT 10')
    expect(sqlSelectStarFromView('bad-name', 10)).toContain('"bad-name"')
  })

  it('sqlSelectColumnFromView quotes column', () => {
    expect(sqlSelectColumnFromView('ds_001', 'bad name')).toContain('"bad name"')
    expect(sqlSelectColumnFromView('ds_001', 'bad name')).toContain('FROM ds_001')
  })

  it('sqlWherePkSample', () => {
    expect(sqlWherePkSample('t', 'id', 'x')).toContain("= 'x'")
    expect(sqlWherePkSample('t', 'id', 'x')).toContain('FROM t')
  })
})

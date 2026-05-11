import { describe, expect, it } from 'vitest'
import {
  quoteIdent,
  quoteLiteral,
  sqlSelectColumnFromView,
  sqlSelectStarFromView,
  sqlWherePkSample,
  viewNameForDataset,
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

  it('viewNameForDataset prefixes', () => {
    expect(viewNameForDataset('ds_001')).toBe('v_ds_001')
  })

  it('sqlSelectStarFromView', () => {
    expect(sqlSelectStarFromView('ds_001', 10)).toContain('v_ds_001')
    expect(sqlSelectStarFromView('ds_001', 10)).toContain('LIMIT 10')
  })

  it('sqlSelectColumnFromView quotes column', () => {
    expect(sqlSelectColumnFromView('ds_001', 'bad name')).toContain('"bad name"')
  })

  it('sqlWherePkSample', () => {
    expect(sqlWherePkSample('ds_001', 'id', 'x')).toContain("= 'x'")
  })
})

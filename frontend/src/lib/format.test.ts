import { describe, expect, it } from 'vitest'
import { formatBytes, formatCount, formatPercent, stripFileExtension } from './format'

describe('format', () => {
  it('formatCount', () => {
    expect(formatCount(1234)).toMatch(/1,?234/)
    expect(formatCount(null)).toBe('—')
  })
  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toContain('KB')
  })
  it('formatPercent', () => {
    expect(formatPercent(14.8811)).toBe('14.88%')
  })
  it('stripFileExtension', () => {
    expect(stripFileExtension('foo.parquet')).toBe('foo')
    expect(stripFileExtension('noext')).toBe('noext')
  })
})

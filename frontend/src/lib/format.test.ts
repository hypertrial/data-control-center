import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatCount,
  formatEdaNumericString,
  formatPercent,
  stripFileExtension,
} from './format'

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
  it('formatEdaNumericString', () => {
    expect(formatEdaNumericString('64.60706690659251')).toBe('64.61')
    expect(formatEdaNumericString('25.335813263280325')).toBe('25.34')
    expect(formatEdaNumericString('10')).toBe('10')
    expect(formatEdaNumericString('3.5')).toBe('3.5')
    expect(formatEdaNumericString(null)).toBe('—')
    expect(formatEdaNumericString('')).toBe('—')
    expect(formatEdaNumericString('   ')).toBe('—')
    expect(formatEdaNumericString('not-a-number')).toBe('not-a-number')
  })
})

import { describe, expect, it } from 'vitest'
import { defaultDuckDbExportAlias } from '@/features/datasets/duckDbExportAlias'

describe('defaultDuckDbExportAlias', () => {
  it('matches backend export stem pattern', () => {
    expect(defaultDuckDbExportAlias('oddsfox.duckdb', { schema: 'main', name: 'orders' })).toBe(
      'oddsfox__main__orders',
    )
  })

  it('strips duckdb extension case-insensitively', () => {
    expect(defaultDuckDbExportAlias('WAREHOUSE.DUCKDB', { schema: 'analytics', name: 't' })).toBe(
      'WAREHOUSE__analytics__t',
    )
  })
})

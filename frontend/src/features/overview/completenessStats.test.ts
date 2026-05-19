import { describe, expect, it } from 'vitest'
import { computeCompletenessStats, rankColumnsByNullPct } from '@/features/overview/completenessStats'
import { mkColumn, mkProfile } from '@/test/profileFixtures'

describe('computeCompletenessStats', () => {
  it('computes populated pct and column counts', () => {
    const stats = computeCompletenessStats(
      mkProfile({
        rows: 1000,
        columns: 10,
        missing_cell_pct: 10,
        duplicate_row_pct: 2,
        column_profiles: [
          mkColumn({ name: 'a', null_pct: 0 }),
          mkColumn({ name: 'b', null_pct: 25 }),
          mkColumn({ name: 'c', null_pct: 100 }),
        ],
      }),
    )
    expect(stats.populatedPct).toBe(90)
    expect(stats.missingPct).toBe(10)
    expect(stats.estimatedMissingCells).toBe(1000)
    expect(stats.estimatedDuplicateRows).toBe(20)
    expect(stats.colsWithNulls).toBe(2)
    expect(stats.colsHighNull).toBe(2)
    expect(stats.colsFullyNull).toBe(1)
    expect(stats.missingSeverity).toBe('ok')
  })

  it('flags warning severity when missing exceeds 20%', () => {
    const stats = computeCompletenessStats(mkProfile({ missing_cell_pct: 25 }))
    expect(stats.missingSeverity).toBe('warning')
  })

  it('detects sample-based profile', () => {
    const stats = computeCompletenessStats(
      mkProfile({ rows: 10_000, profiler_sample_rows: 2000 }),
    )
    expect(stats.isSampleProfile).toBe(true)
    expect(stats.sampleLabel).toBe('Based on 2,000-row sample')
  })

  it('handles null aggregate fields', () => {
    const stats = computeCompletenessStats(
      mkProfile({
        missing_cell_pct: null,
        duplicate_row_pct: null,
        column_profiles: [],
      }),
    )
    expect(stats.populatedPct).toBeNull()
    expect(stats.estimatedMissingCells).toBeNull()
    expect(stats.estimatedDuplicateRows).toBeNull()
    expect(stats.colsWithNulls).toBe(0)
  })
})

describe('rankColumnsByNullPct', () => {
  it('returns top columns by null pct', () => {
    const ranked = rankColumnsByNullPct(
      [
        mkColumn({ name: 'low', null_pct: 1 }),
        mkColumn({ name: 'high', null_pct: 90 }),
        mkColumn({ name: 'mid', null_pct: 40 }),
      ],
      2,
    )
    expect(ranked.names).toEqual(['high', 'mid'])
    expect(ranked.values).toEqual([90, 40])
  })
})

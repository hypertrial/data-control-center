import { describe, expect, it } from 'vitest'
import type { DatasetProfile } from '@/api/types'
import { buildSuggestedPrompts } from '@/features/ask/askPrompts'

const baseProfile: DatasetProfile = {
  dataset_id: 'ds_1',
  name: 'orders',
  rows: 100,
  columns: 5,
  file_size_bytes: 1000,
  missing_cell_pct: null,
  duplicate_row_pct: null,
  numeric_column_count: 2,
  categorical_column_count: 1,
  datetime_column_count: 1,
  quality_score: 80,
  narrative: '',
  likely_grain: null,
  main_numeric_measures: ['amount'],
  structure_version: 'v4',
  temporal_columns: [],
  entity_id_columns: [{ name: 'customer_id', confidence: 'high' }],
  grain_key_candidates: [{ columns: ['order_id'], uniqueness_ratio: 1, confidence: 'high', rank: 1 }],
  primary_grain_key_columns: ['order_id'],
  primary_temporal_column: { name: 'created_at', kind: 'continuous_datetime', confidence: 'high' },
  measure_candidates: [{ name: 'amount', score: 0.9, confidence: 'high' }],
  structure_warnings: [],
  column_profiles: [
    {
      name: 'status',
      physical_type: 'VARCHAR',
      semantic_type: 'categorical',
      null_pct: 0,
      unique_count: 3,
      cardinality: 3,
      min_value: null,
      max_value: null,
      top_values: [],
      quality_flags: [],
      histogram: null,
    },
    {
      name: 'notes',
      physical_type: 'VARCHAR',
      semantic_type: 'text',
      null_pct: 40,
      unique_count: 10,
      cardinality: 10,
      min_value: null,
      max_value: null,
      top_values: [],
      quality_flags: [],
      histogram: null,
    },
  ],
  quality_issues: [],
}

describe('buildSuggestedPrompts', () => {
  it('includes grain, entity, temporal, and measure aware prompts', () => {
    const prompts = buildSuggestedPrompts(baseProfile)
    expect(prompts.some((p) => p.includes('order_id'))).toBe(true)
    expect(prompts.some((p) => p.includes('customer_id'))).toBe(true)
    expect(prompts.some((p) => p.includes('created_at'))).toBe(true)
    expect(
      prompts.some((p) => p.includes('amount') || p.includes('summary statistics')),
    ).toBe(true)
  })
})

import type { ColumnProfile, DatasetProfile, QualityIssue } from '@/api/types'

export function mkProfile(overrides: Partial<DatasetProfile> = {}): DatasetProfile {
  return {
    dataset_id: 'ds_001',
    name: 'Demo',
    rows: 10,
    columns: 2,
    file_size_bytes: 500,
    missing_cell_pct: 1,
    duplicate_row_pct: 0,
    numeric_column_count: 1,
    categorical_column_count: 1,
    datetime_column_count: 0,
    potential_id_columns: [],
    potential_key_columns: [],
    quality_score: 90,
    narrative: '**Hi** there',
    likely_grain: 'One row per id.',
    primary_date_column: 'created',
    main_numeric_measures: ['x'],
    column_profiles: [],
    quality_issues: [],
    ...overrides,
  }
}

export function mkColumn(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name: 'col_a',
    physical_type: 'Int64',
    semantic_type: 'numeric',
    null_pct: 0,
    unique_count: 10,
    cardinality: 10,
    min_value: '0',
    max_value: '9',
    top_values: [{ value: 1, count: 2 }],
    quality_flags: ['high_missingness'],
    histogram: null,
    ...overrides,
  }
}

export function mkIssue(overrides: Partial<QualityIssue> = {}): QualityIssue {
  return {
    id: 'i1',
    severity: 'warning',
    category: 'x',
    title: 'T',
    description: 'D',
    why_it_matters: 'W',
    affected_columns: [],
    examples: [],
    suggested_sql: null,
    score_impact: 1,
    ...overrides,
  }
}

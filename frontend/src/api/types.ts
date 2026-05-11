export type DatasetSummary = {
  dataset_id: string
  name: string
  view_name: string
  source_path: string
  format: string
  row_count: number | null
  column_count: number | null
  file_size_bytes: number | null
  quality_score?: number | null
}

export type SemanticType =
  | 'unknown'
  | 'id_like'
  | 'numeric'
  | 'categorical'
  | 'datetime'
  | 'boolean_like'
  | 'text'

export type QualitySeverity = 'critical' | 'warning' | 'info'

export type ColumnProfile = {
  name: string
  physical_type: string
  semantic_type: SemanticType
  null_pct: number
  unique_count: number | null
  cardinality: number | null
  min_value: string | null
  max_value: string | null
  top_values: Array<{ value: unknown; count: number }>
  quality_flags: string[]
  histogram: Array<{ bin: string; count: number }> | null
}

export type QualityIssue = {
  id: string
  severity: QualitySeverity
  category: string
  title: string
  description: string
  why_it_matters: string
  affected_columns: string[]
  examples: unknown[]
  suggested_sql: string | null
  score_impact: number
}

export type DatasetProfile = {
  dataset_id: string
  name: string
  rows: number
  columns: number
  file_size_bytes: number | null
  missing_cell_pct: number | null
  duplicate_row_pct: number | null
  numeric_column_count: number
  categorical_column_count: number
  datetime_column_count: number
  potential_id_columns: string[]
  potential_key_columns: string[]
  quality_score: number | null
  narrative: string
  likely_grain: string | null
  primary_date_column: string | null
  main_numeric_measures: string[]
  column_profiles: ColumnProfile[]
  quality_issues: QualityIssue[]
}

export type QueryRequest = {
  sql: string
  max_rows?: number | null
}

export type QueryResultColumn = {
  name: string
  type: string | null
}

export type QueryResult = {
  columns: QueryResultColumn[]
  rows: Record<string, unknown>[]
  row_count: number
  truncated: boolean
  error: string | null
}

export type AgentAskRequest = {
  question: string
  dataset_ids?: string[] | null
  max_rows?: number | null
}

export type AgentAskResponse = {
  answer?: string | null
  sql?: string | null
  explanation?: string | null
  query_result?: QueryResult | null
  model: string
  error?: string | null
}

export type SampleResponse = {
  page: number
  page_size: number
  row_count: number
  total_rows: number
  columns: string[]
  rows: Record<string, unknown>[]
}

export type ApiError = {
  code: string
  message: string
  details?: Record<string, unknown> | null
  trace_id?: string
}

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
export type StructureConfidence = 'low' | 'medium' | 'high'
export type TemporalKind = 'continuous_datetime' | 'discrete_period'

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
  structure_version: string
  temporal_columns: Array<{ name: string; kind: TemporalKind; confidence: StructureConfidence }>
  entity_id_columns: Array<{ name: string; confidence: StructureConfidence }>
  grain_key_candidates: Array<{
    columns: string[]
    uniqueness_ratio: number
    confidence: StructureConfidence
    rank: number
  }>
  primary_grain_key_columns: string[]
  primary_temporal_column: { name: string; kind: TemporalKind; confidence: StructureConfidence } | null
  measure_candidates: Array<{ name: string; score: number; confidence: StructureConfidence }>
  structure_warnings: string[]
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
  conversation_id?: string | null
  use_history?: boolean
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

export type ProfileHistoryEntry = {
  history_id: string
  dataset_id: string
  created_at: string
  quality_score: number | null
  rows: number | null
  columns: number | null
  missing_cell_pct: number | null
}

export type NullPctChange = {
  column: string
  before: number
  after: number
  delta: number
}

export type ProfileDiffResponse = {
  history_id_a: string
  history_id_b: string
  created_at_a: string
  created_at_b: string
  new_columns: string[]
  removed_columns: string[]
  null_pct_changes: NullPctChange[]
  quality_score_delta: number | null
}

export type SavedQuery = {
  saved_id: string
  name: string
  sql: string
  created_at: string
  updated_at: string
}

export type SavedQueryCreate = {
  name: string
  sql: string
}

export type SavedQueryPatch = {
  name?: string | null
  sql?: string | null
}

export type AskConversation = {
  conversation_id: string
  title: string
  dataset_ids: string[] | null
  created_at: string
  updated_at: string
}

export type AskTurn = {
  turn_id: string
  conversation_id: string
  seq: number
  question: string
  sql?: string | null
  explanation?: string | null
  answer?: string | null
  error?: string | null
  attempts: Record<string, unknown>[]
  query_result?: QueryResult | null
  model?: string | null
  elapsed_ms?: number | null
  created_at: string
}

export type AskConversationCreate = {
  title?: string | null
  dataset_ids?: string[] | null
}

export type AskConversationPatch = {
  title?: string | null
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

export type JobSummary = {
  job_id: string
  kind: string
  dataset_id: string | null
  status: JobStatus
  progress: number
  error_code?: string | null
  error_message?: string | null
  cancel_requested: boolean
  created_at: string
  updated_at: string
  finished_at?: string | null
}

export type JobDetail = JobSummary & {
  result?: Record<string, unknown> | null
}

export type JobCreateResponse = {
  job_id: string
  status: JobStatus
}

/** SSE payloads from `POST /api/agent/ask/stream`. */
export type AgentStreamEvent =
  | { type: 'meta'; data: Record<string, unknown> }
  | {
      type: 'stage'
      data: {
        name: 'context' | 'draft_sql' | 'execute' | 'retry' | 'summarize'
        attempt?: number
        elapsed_ms?: number
      }
    }
  | { type: 'sql_attempt'; data: { sql: string; error?: string | null; attempt: number } }
  | { type: 'timing'; data: { total_ms: number } }
  | { type: 'turn'; data: { turn_id: string; conversation_id: string; seq: number } }
  | { type: 'sql'; data: { sql: string; explanation?: string | null } }
  | { type: 'query_result'; data: QueryResult }
  | { type: 'token'; data: { text: string } }
  | { type: 'answer'; data: { answer: string } }
  | {
      type: 'error'
      data: { message: string; sql?: string | null; explanation?: string | null; query_result?: QueryResult }
    }
  | { type: 'done'; data: Record<string, unknown> }

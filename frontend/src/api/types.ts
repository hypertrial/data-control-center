export type ApiError = {
  code: string
  message: string
  details?: Record<string, unknown> | null
  trace_id?: string
}

export type LlmHealth = {
  reachable: boolean
  model: string
  detail: string | null
}

export type HealthResponse = {
  status: string
  llm: LlmHealth
}

export type LlmModelInfo = {
  name: string
  modified_at?: string | null
  size?: number | null
}

export type LlmModelsResponse = {
  default_model: string
  models: LlmModelInfo[]
  reachable: boolean
  detail: string | null
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

export type DuckDbCapabilities = {
  local_open_enabled: boolean
  upload_soft_max_bytes: number
  inspect_include_row_counts_default: boolean
  native_pick_enabled: boolean
  view_import_enabled: boolean
}

export type DuckDbSourceResponse = {
  source_id: string
  filename: string
  source_kind: 'upload' | 'local'
}

export type DuckDbRelationSummary = {
  schema: string
  name: string
  type: 'table' | 'view'
  column_count: number
  row_count: number | null
}

export type DuckDbRelationRef = {
  schema: string
  name: string
  alias?: string | null
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
export type MetricScope = 'full' | 'sample'
export type StructureConfidence = 'low' | 'medium' | 'high'
export type TemporalKind = 'continuous_datetime' | 'discrete_period'
export type HistogramBin = {
  lower_bound: number | null
  upper_bound: number | null
  left_closed: boolean
  right_closed: boolean
  count: number
  pct_non_null: number
}

export type ColumnProfile = {
  name: string
  physical_type: string
  semantic_type: SemanticType
  null_pct: number
  non_null_count?: number | null
  null_count?: number | null
  unique_count: number | null
  unique_pct?: number | null
  cardinality: number | null
  min_value: string | null
  max_value: string | null
  mean_value?: string | null
  std_value?: string | null
  median_value?: string | null
  p25_value?: string | null
  p75_value?: string | null
  top_value?: string | null
  top_count?: number | null
  top_pct?: number | null
  top_values: Array<{ value: unknown; count: number }>
  quality_flags: string[]
  histogram: HistogramBin[] | null
  metric_scope?: MetricScope
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
  profiler_sample_rows?: number
  file_size_bytes: number | null
  missing_cell_pct: number | null
  duplicate_row_pct: number | null
  duplicate_row_pct_scope?: MetricScope | null
  profile_metric_warnings?: string[]
  numeric_column_count: number
  categorical_column_count: number
  datetime_column_count: number
  quality_score: number | null
  narrative: string
  likely_grain: string | null
  main_numeric_measures: string[]
  structure_version: string
  grain_key_scope?: MetricScope
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
  model?: string | null
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
  description: string | null
  created_at: string
  updated_at: string
}

export type SavedQueryCreate = {
  name: string
  sql: string
  description?: string | null
}

export type SavedQueryPatch = {
  name?: string | null
  sql?: string | null
  description?: string | null
}

export type SavedChart = {
  chart_id: string
  dataset_id: string
  name: string
  description: string | null
  spec: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type SavedChartCreate = {
  dataset_id: string
  name: string
  description?: string | null
  spec: Record<string, unknown>
}

export type SavedChartPatch = {
  name?: string
  description?: string | null
  spec?: Record<string, unknown>
}

export type DatasetDependencies = {
  saved_chart_count: number
  relationship_decision_count: number
}

export type RelationshipEndpoint = {
  dataset_id: string
  dataset_name: string
  view_name: string
  column_name: string
  physical_type: string | null
  semantic_type: string | null
  unique_pct: number | null
  metric_scope: string | null
}

export type DatasetRelationship = {
  relationship_id: string
  left: RelationshipEndpoint
  right: RelationshipEndpoint
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'unknown'
  confidence: 'high' | 'medium'
  reasons: string[]
  decision: 'suggested' | 'confirmed' | 'dismissed'
  availability: 'ready' | 'stale'
  suggested_sql: string | null
}

export type RelationshipsResponse = {
  relationships: DatasetRelationship[]
  pending_dataset_ids: string[]
}

export type RelationshipVerification = {
  relationship_id: string
  scope: 'sample'
  left_sample_rows: number
  right_sample_rows: number
  left_distinct: number
  right_distinct: number
  overlap_distinct: number
  left_match_pct: number
  right_match_pct: number
  verdict: 'strong' | 'partial' | 'weak' | 'no_overlap'
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

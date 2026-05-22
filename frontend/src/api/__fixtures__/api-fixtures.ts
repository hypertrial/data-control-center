/** Representative API payloads for types conformance tests. */

import type {
  AgentAskResponse,
  AgentStreamEvent,
  AskConversation,
  AskTurn,
  DatasetProfile,
  DatasetSummary,
  HealthResponse,
  JobDetail,
  LlmModelsResponse,
  ProfileDiffResponse,
  QueryResult,
  SampleResponse,
  SavedChart,
  SavedQuery,
} from '../types'

export const healthResponseFixture: HealthResponse = {
  status: 'ok',
  llm: { reachable: true, model: 'qwen3:4b', detail: null },
}

export const llmModelsResponseFixture: LlmModelsResponse = {
  default_model: 'qwen3:4b',
  models: [{ name: 'qwen3:4b', modified_at: null, size: null }],
  reachable: true,
  detail: null,
}

export const datasetSummaryFixture: DatasetSummary = {
  dataset_id: 'ds_001',
  name: 'rows.csv',
  view_name: 'rows',
  source_path: 'rows.csv',
  format: 'csv',
  row_count: 2,
  column_count: 2,
  file_size_bytes: 100,
  quality_score: 95,
}

export const queryResultFixture: QueryResult = {
  columns: [{ name: 'id', type: 'BIGINT' }],
  rows: [{ id: 1 }],
  row_count: 1,
  truncated: false,
  error: null,
}

export const agentAskResponseFixture: AgentAskResponse = {
  model: 'qwen3:4b',
  answer: 'Done',
  sql: 'SELECT 1',
  explanation: 'test',
  query_result: queryResultFixture,
  error: null,
}

export const sampleResponseFixture: SampleResponse = {
  page: 1,
  page_size: 10,
  row_count: 1,
  total_rows: 1,
  columns: ['id'],
  rows: [{ id: 1 }],
}

export const profileDiffFixture: ProfileDiffResponse = {
  history_id_a: 'h1',
  history_id_b: 'h2',
  created_at_a: '2026-01-01T00:00:00Z',
  created_at_b: '2026-01-02T00:00:00Z',
  new_columns: [],
  removed_columns: [],
  null_pct_changes: [{ column: 'x', before: 0, after: 1, delta: 1 }],
  quality_score_delta: -1,
}

export const savedQueryFixture: SavedQuery = {
  saved_id: 'sq1',
  name: 'q',
  sql: 'SELECT 1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

export const savedChartFixture: SavedChart = {
  chart_id: 'ch1',
  dataset_id: 'ds_001',
  name: 'Ratings trend',
  spec_json: '{"version":2,"chartType":"line"}',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

export const askConversationFixture: AskConversation = {
  conversation_id: 'c1',
  title: 'Test',
  dataset_ids: ['ds_001'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

export const askTurnFixture: AskTurn = {
  turn_id: 't1',
  conversation_id: 'c1',
  seq: 1,
  question: 'count?',
  sql: 'SELECT COUNT(*) FROM rows',
  answer: '2',
  attempts: [],
  created_at: '2026-01-01T00:00:00Z',
}

export const jobDetailFixture: JobDetail = {
  job_id: 'j1',
  kind: 'profile_refresh',
  dataset_id: 'ds_001',
  status: 'completed',
  progress: 1,
  cancel_requested: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  result: { ok: true },
}

export const datasetProfileFixture: DatasetProfile = {
  dataset_id: 'ds_001',
  name: 'rows.csv',
  rows: 2,
  columns: 2,
  file_size_bytes: 100,
  missing_cell_pct: 0,
  duplicate_row_pct: 0,
  duplicate_row_pct_scope: 'full',
  profile_metric_warnings: [],
  numeric_column_count: 1,
  categorical_column_count: 1,
  datetime_column_count: 0,
  quality_score: 95,
  narrative: 'Test',
  likely_grain: 'One row per id.',
  main_numeric_measures: ['val'],
  structure_version: 'v6',
  temporal_columns: [],
  entity_id_columns: [{ name: 'id', confidence: 'high' }],
  grain_key_candidates: [],
  primary_grain_key_columns: ['id'],
  primary_temporal_column: null,
  measure_candidates: [],
  structure_warnings: [],
  column_profiles: [
    {
      name: 'id',
      physical_type: 'BIGINT',
      semantic_type: 'id_like',
      null_pct: 0,
      unique_count: 2,
      cardinality: 2,
      min_value: '1',
      max_value: '2',
      top_values: [],
      quality_flags: [],
      histogram: [
        {
          lower_bound: null,
          upper_bound: 2,
          left_closed: false,
          right_closed: true,
          count: 1,
          pct_non_null: 50,
        },
        {
          lower_bound: 2,
          upper_bound: null,
          left_closed: false,
          right_closed: false,
          count: 1,
          pct_non_null: 50,
        },
      ],
    },
  ],
  quality_issues: [],
}

export const agentStreamEventFixtures: AgentStreamEvent[] = [
  { type: 'meta', data: { model: 'qwen3:4b' } },
  { type: 'stage', data: { name: 'context', elapsed_ms: 1 } },
  { type: 'sql', data: { sql: 'SELECT 1', explanation: null } },
  { type: 'query_result', data: queryResultFixture },
  { type: 'answer', data: { answer: 'ok' } },
  { type: 'done', data: {} },
]

import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  agentAskResponseFixture,
  agentStreamEventFixtures,
  askConversationFixture,
  askTurnFixture,
  datasetProfileFixture,
  datasetSummaryFixture,
  healthResponseFixture,
  jobDetailFixture,
  profileDiffFixture,
  queryResultFixture,
  sampleResponseFixture,
  savedQueryFixture,
} from './__fixtures__/api-fixtures'
import type {
  AgentAskRequest,
  AgentAskResponse,
  AgentStreamEvent,
  ApiError,
  AskConversation,
  AskConversationCreate,
  AskConversationPatch,
  AskTurn,
  ColumnProfile,
  DatasetProfile,
  DatasetSummary,
  HealthResponse,
  JobCreateResponse,
  JobDetail,
  JobStatus,
  JobSummary,
  LlmHealth,
  NullPctChange,
  ProfileDiffResponse,
  ProfileHistoryEntry,
  QueryRequest,
  QueryResult,
  QueryResultColumn,
  SampleResponse,
  SavedQuery,
  SavedQueryCreate,
  SavedQueryPatch,
} from './types'

describe('api types conformance', () => {
  it('ApiError shape', () => {
    const err: ApiError = { code: 'X', message: 'm' }
    expect(err).toMatchObject({ code: 'X', message: 'm' })
  })

  it('LlmHealth shape', () => {
    expectTypeOf(healthResponseFixture.llm).toEqualTypeOf<LlmHealth>()
    expect(healthResponseFixture.llm.reachable).toBe(true)
  })

  it('HealthResponse fixture', () => {
    expectTypeOf(healthResponseFixture).toEqualTypeOf<HealthResponse>()
    expect(healthResponseFixture).toMatchObject({ status: 'ok' })
  })

  it('DatasetSummary fixture', () => {
    expectTypeOf(datasetSummaryFixture).toEqualTypeOf<DatasetSummary>()
    expect(datasetSummaryFixture.dataset_id).toBe('ds_001')
  })

  it('ColumnProfile nested in DatasetProfile', () => {
    const col: ColumnProfile = datasetProfileFixture.column_profiles[0]!
    expect(col.semantic_type).toBe('id_like')
  })

  it('DatasetProfile fixture', () => {
    expectTypeOf(datasetProfileFixture).toEqualTypeOf<DatasetProfile>()
    expect(datasetProfileFixture.structure_version).toBe('v4')
  })

  it('QueryRequest and QueryResult', () => {
    const req: QueryRequest = { sql: 'SELECT 1' }
    expectTypeOf(queryResultFixture).toEqualTypeOf<QueryResult>()
    const col: QueryResultColumn = queryResultFixture.columns[0]!
    expect(col.name).toBe('id')
    expect(req.sql).toBeTruthy()
  })

  it('AgentAskRequest and AgentAskResponse', () => {
    const req: AgentAskRequest = { question: 'q', use_history: true }
    expectTypeOf(agentAskResponseFixture).toEqualTypeOf<AgentAskResponse>()
    expect(req.question).toBe('q')
    expect(agentAskResponseFixture.model).toBeTruthy()
  })

  it('SampleResponse fixture', () => {
    expectTypeOf(sampleResponseFixture).toEqualTypeOf<SampleResponse>()
    expect(sampleResponseFixture.rows).toHaveLength(1)
  })

  it('ProfileHistoryEntry and ProfileDiffResponse', () => {
    const hist: ProfileHistoryEntry = {
      history_id: 'h1',
      dataset_id: 'ds_001',
      created_at: '2026-01-01T00:00:00Z',
      quality_score: 90,
      rows: 1,
      columns: 1,
      missing_cell_pct: 0,
    }
    expectTypeOf(profileDiffFixture).toEqualTypeOf<ProfileDiffResponse>()
    const change: NullPctChange = profileDiffFixture.null_pct_changes[0]!
    expect(change.column).toBe('x')
    expect(hist.history_id).toBe('h1')
  })

  it('SavedQuery variants', () => {
    expectTypeOf(savedQueryFixture).toEqualTypeOf<SavedQuery>()
    const create: SavedQueryCreate = { name: 'n', sql: 'SELECT 1' }
    const patch: SavedQueryPatch = { name: 'n2' }
    expect(create.sql).toBeTruthy()
    expect(patch.name).toBe('n2')
  })

  it('Ask conversation and turn', () => {
    expectTypeOf(askConversationFixture).toEqualTypeOf<AskConversation>()
    expectTypeOf(askTurnFixture).toEqualTypeOf<AskTurn>()
    const create: AskConversationCreate = { title: 't' }
    const patch: AskConversationPatch = { title: 't2' }
    expect(create.title).toBe('t')
    expect(patch.title).toBe('t2')
  })

  it('Job types', () => {
    const status: JobStatus = 'queued'
    expectTypeOf(jobDetailFixture).toEqualTypeOf<JobDetail>()
    const summary: JobSummary = jobDetailFixture
    const created: JobCreateResponse = { job_id: 'j1', status: 'queued' }
    expect(status).toBe('queued')
    expect(summary.job_id).toBe('j1')
    expect(created.status).toBe('queued')
  })

  it('AgentStreamEvent discriminated union', () => {
    for (const ev of agentStreamEventFixtures) {
      expectTypeOf(ev).toEqualTypeOf<AgentStreamEvent>()
      expect(ev.type).toBeTruthy()
    }
  })
})

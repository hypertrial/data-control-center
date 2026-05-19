import { describe, expect, it } from 'vitest'
import type { AskTurn, DatasetProfile } from '@/api/types'
import {
  buildFollowUps,
  isPersistedStreamingTurn,
  shouldShowStreamingModelNote,
} from '@/features/ask/askTurnDisplay'

describe('askTurnDisplay', () => {
  it('shouldShowStreamingModelNote only before final answer arrives', () => {
    expect(shouldShowStreamingModelNote('Counted rows.', null)).toBe(true)
    expect(shouldShowStreamingModelNote('Counted rows.', 'Counted rows.\n\nReturned 1 row.')).toBe(false)
    expect(shouldShowStreamingModelNote(null, 'Done.')).toBe(false)
  })

  it('isPersistedStreamingTurn matches turn ids in thread', () => {
    expect(isPersistedStreamingTurn([{ turn_id: 't1' }], 't1')).toBe(true)
    expect(isPersistedStreamingTurn([{ turn_id: 't1' }], 't2')).toBe(false)
    expect(isPersistedStreamingTurn([], 't1')).toBe(false)
  })

  it('buildFollowUps suggests profile-aware follow-up chips', () => {
    const turn = {
      turn_id: 't1',
      conversation_id: 'c1',
      seq: 1,
      question: 'Q',
      sql: 'SELECT 1',
      answer: 'Done',
      attempts: [],
      query_result: {
        columns: [{ name: 'n', type: 'INTEGER' }],
        rows: [{ n: 1 }],
        row_count: 1,
        truncated: false,
        error: null,
      },
      created_at: 'now',
    } satisfies AskTurn
    const profile = {
      entity_id_columns: [{ name: 'customer_id', confidence: 'high' }],
      primary_temporal_column: { name: 'created_at', kind: 'continuous_datetime', confidence: 'high' },
      primary_grain_key_columns: ['order_id'],
    } as DatasetProfile
    const chips = buildFollowUps(turn, profile)
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.some((c) => c.includes('customer_id'))).toBe(true)
  })
})

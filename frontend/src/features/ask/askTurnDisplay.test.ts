import { describe, expect, it } from 'vitest'
import { isPersistedStreamingTurn, shouldShowStreamingModelNote } from '@/features/ask/askTurnDisplay'

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
})

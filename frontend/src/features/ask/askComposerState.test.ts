import { describe, expect, it, beforeEach } from 'vitest'
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  deserializeAskScope,
  readSavedAskModel,
  saveAskModel,
  serializeAskScope,
  settingsSummary,
  scopeSummary,
  type AskScope,
} from '@/features/ask/askComposerState'

describe('askComposerState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads and saves model preference', () => {
    expect(readSavedAskModel()).toBe('')
    saveAskModel('llama3.2:3b')
    expect(readSavedAskModel()).toBe('llama3.2:3b')
  })

  it('summarizes dataset scope', () => {
    expect(scopeSummary('all', 3)).toBe('All datasets')
    const partial: AskScope = new Set(['ds_a', 'ds_b'])
    expect(scopeSummary(partial, 3)).toBe('2/3 datasets')
  })

  it('derives a truncated conversation title from the first question', () => {
    expect(deriveConversationTitle('  How many rows are in this dataset?  ')).toBe(
      'How many rows are in this dataset?',
    )
    const long = 'a'.repeat(60)
    expect(deriveConversationTitle(long).endsWith('…')).toBe(true)
    expect(deriveConversationTitle('')).toBe(DEFAULT_CONVERSATION_TITLE)
  })

  it('serializes scope and builds settings summary', () => {
    expect(serializeAskScope('all')).toBe('all')
    expect(serializeAskScope(new Set(['ds_a']))).toEqual(['ds_a'])
    expect(deserializeAskScope(['ds_a'])).toEqual(new Set(['ds_a']))
    expect(settingsSummary('qwen', 200, 'all', 2)).toContain('All datasets')
  })
})

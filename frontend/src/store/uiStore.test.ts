import { describe, expect, it } from 'vitest'
import { useUiStore } from '@/store/uiStore'

describe('uiStore', () => {
  it('updates dataset and column UI fields', () => {
    useUiStore.getState().setActiveDatasetId('ds_1')
    expect(useUiStore.getState().activeDatasetId).toBe('ds_1')
    useUiStore.getState().setActiveDatasetId(null)
    expect(useUiStore.getState().activeDatasetId).toBeNull()

    useUiStore.getState().setSelectedColumn('c1')
    expect(useUiStore.getState().selectedColumn).toBe('c1')

    useUiStore.getState().setColumnDrawerOpen(true)
    expect(useUiStore.getState().columnDrawerOpen).toBe(true)

    useUiStore.getState().setColumnSearch('x')
    expect(useUiStore.getState().columnSearch).toBe('x')

    useUiStore.getState().setSemanticFilter('numeric')
    expect(useUiStore.getState().semanticFilter).toBe('numeric')

    useUiStore.getState().setColumnQualityFilter('has_flags')
    expect(useUiStore.getState().columnQualityFilter).toBe('has_flags')

    useUiStore.getState().setPendingQuery('SELECT 1')
    expect(useUiStore.getState().pendingQuery).toBe('SELECT 1')
    expect(useUiStore.getState().takePendingQuery()).toBe('SELECT 1')
    expect(useUiStore.getState().pendingQuery).toBeNull()

    useUiStore.getState().setPendingAskQuestion('What changed?')
    expect(useUiStore.getState().takePendingAskQuestion()).toBe('What changed?')
    expect(useUiStore.getState().pendingAskQuestion).toBeNull()

    useUiStore.getState().setCommandPaletteOpen(true)
    expect(useUiStore.getState().commandPaletteOpen).toBe(true)

    useUiStore.getState().toggleColumnTableVisibility('ds_x', 'name')
    expect(useUiStore.getState().columnsTableHidden.ds_x).toContain('name')
    useUiStore.getState().toggleColumnTableVisibility('ds_x', 'name')
    expect(useUiStore.getState().columnsTableHidden.ds_x).not.toContain('name')

    useUiStore.getState().setColumnsDensity('compact')
    expect(useUiStore.getState().columnsDensity).toBe('compact')

    useUiStore.getState().setSqlEditorHeight(360)
    expect(useUiStore.getState().sqlEditorHeight).toBe(360)
    useUiStore.getState().setSqlSchemaCollapsed(false)
    expect(useUiStore.getState().sqlSchemaCollapsed).toBe(false)

    useUiStore.getState().setAskConversationHistoryCollapsed(true)
    expect(useUiStore.getState().askConversationHistoryCollapsed).toBe(true)
    useUiStore.getState().setAskConversationHistoryCollapsed(false)
    expect(useUiStore.getState().askConversationHistoryCollapsed).toBe(false)
  })

  it('stores per-conversation Ask prefs and local error turns', () => {
    useUiStore.getState().setAskConversationPrefs('c1', { maxRows: 50, scope: ['ds_a'] })
    expect(useUiStore.getState().askConversationPrefs.c1).toEqual({
      maxRows: 50,
      scope: ['ds_a'],
    })

    useUiStore.getState().pushAskErrorTurn('c1', {
      id: 'err-1',
      question: 'Why?',
      error: 'failed',
      createdAt: 1,
    })
    expect(useUiStore.getState().recentErrorsByConversation.c1).toHaveLength(1)

    useUiStore.getState().clearAskErrorsMatchingQuestion('c1', 'Why?')
    expect(useUiStore.getState().recentErrorsByConversation.c1).toHaveLength(0)

    useUiStore.getState().pushAskErrorTurn('c1', {
      id: 'err-2',
      question: 'Why?',
      error: 'failed again',
      createdAt: 2,
    })
    useUiStore.getState().removeAskErrorTurn('c1', 'err-2')
    expect(useUiStore.getState().recentErrorsByConversation.c1).toHaveLength(0)
  })
})

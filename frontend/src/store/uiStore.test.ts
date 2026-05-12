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

    useUiStore.getState().setQualitySeverityFilter('warning')
    expect(useUiStore.getState().qualitySeverityFilter).toBe('warning')

    useUiStore.getState().setColumnQualityFilter('has_flags')
    expect(useUiStore.getState().columnQualityFilter).toBe('has_flags')

    useUiStore.getState().setPendingQuery('SELECT 1')
    expect(useUiStore.getState().pendingQuery).toBe('SELECT 1')
    expect(useUiStore.getState().takePendingQuery()).toBe('SELECT 1')
    expect(useUiStore.getState().pendingQuery).toBeNull()

    useUiStore.getState().setCommandPaletteOpen(true)
    expect(useUiStore.getState().commandPaletteOpen).toBe(true)

    useUiStore.getState().toggleColumnTableVisibility('ds_x', 'name')
    expect(useUiStore.getState().columnsTableHidden.ds_x).toContain('name')
    useUiStore.getState().toggleColumnTableVisibility('ds_x', 'name')
    expect(useUiStore.getState().columnsTableHidden.ds_x).not.toContain('name')
  })
})

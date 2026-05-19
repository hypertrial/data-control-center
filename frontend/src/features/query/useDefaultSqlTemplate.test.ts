import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDefaultSqlTemplate } from '@/features/query/useDefaultSqlTemplate'
import { useUiStore } from '@/store/uiStore'

describe('useDefaultSqlTemplate', () => {
  beforeEach(() => {
    useUiStore.setState({ pendingQuery: null, sqlInjectTick: 0 })
  })

  it('injects pending SQL when sqlInjectTick bumps', async () => {
    let sql = 'select 1;'
    const setSql = vi.fn((next: string) => {
      sql = next
    })
    useUiStore.setState({ pendingQuery: 'SELECT pending', sqlInjectTick: 1 })

    renderHook(() => useDefaultSqlTemplate(sql, setSql, 'ds_001', 'foo', 1))
    await waitFor(() => expect(setSql).toHaveBeenCalledWith('select pending;'))
  })

  it('applies dataset template when sql is empty', async () => {
    const setSql = vi.fn()
    renderHook(() => useDefaultSqlTemplate('   ', setSql, 'ds_001', 'foo', 0))
    await waitFor(() => expect(setSql).toHaveBeenCalled())
    const applied = setSql.mock.calls.at(-1)?.[0] as string
    expect(applied).toContain('foo')
  })

  it('preserves user edits when switching datasets', () => {
    const setSql = vi.fn()
    const { rerender } = renderHook(
      ({ activeId, view, text }: { activeId: string | null; view?: string; text: string }) =>
        useDefaultSqlTemplate(text, setSql, activeId, view, 0),
      { initialProps: { activeId: 'ds_001', view: 'foo', text: 'SELECT custom FROM foo' } },
    )

    setSql.mockClear()
    rerender({ activeId: 'ds_002', view: 'bar', text: 'SELECT custom FROM foo' })
    expect(setSql).not.toHaveBeenCalled()
  })
})

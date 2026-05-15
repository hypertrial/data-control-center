import { useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useUiStore } from '@/store/uiStore'

const SEM_VALUES = new Set([
  'all',
  'numeric',
  'categorical',
  'datetime',
  'id_like',
  'boolean_like',
  'text',
  'unknown',
])

const SEV_VALUES = new Set(['all', 'critical', 'warning', 'info'])

function decodeColumnQuality(v: string | null): 'all' | 'has_flags' | 'critical_only' | null {
  if (v == null || v === '') return null
  if (v === 'all') return 'all'
  if (v === 'flags') return 'has_flags'
  if (v === 'critical') return 'critical_only'
  return null
}

function encodeColumnQuality(v: 'all' | 'has_flags' | 'critical_only'): string | null {
  if (v === 'all') return null
  if (v === 'has_flags') return 'flags'
  return 'critical'
}

/**
 * Keeps `activeDatasetId` and filters in sync with the query string (`ds`, `q`, `sem`, `sev`, `col`, `cq`),
 * and auto-selects the first dataset when the workspace has data but the URL omits `ds`.
 */
export function UiUrlSync() {
  const [searchParams, setSearchParams] = useSearchParams()
  const pathname = useLocation().pathname
  const dq = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })

  const activeId = useUiStore((s) => s.activeDatasetId)
  const columnSearch = useUiStore((s) => s.columnSearch)
  const semanticFilter = useUiStore((s) => s.semanticFilter)
  const qualitySeverityFilter = useUiStore((s) => s.qualitySeverityFilter)
  const columnQualityFilter = useUiStore((s) => s.columnQualityFilter)
  const selectedColumn = useUiStore((s) => s.selectedColumn)
  const drawerOpen = useUiStore((s) => s.columnDrawerOpen)

  const setActive = useUiStore((s) => s.setActiveDatasetId)
  const setColumnSearch = useUiStore((s) => s.setColumnSearch)
  const setSemantic = useUiStore((s) => s.setSemanticFilter)
  const setSev = useUiStore((s) => s.setQualitySeverityFilter)
  const setColumnQuality = useUiStore((s) => s.setColumnQualityFilter)
  const setSelectedColumn = useUiStore((s) => s.setSelectedColumn)
  const setDrawerOpen = useUiStore((s) => s.setColumnDrawerOpen)

  useEffect(() => {
    if (dq.isLoading) return
    const list = dq.data ?? []
    if (!list.length) return
    const ds = searchParams.get('ds')
    if (ds) return
    const cur = useUiStore.getState().activeDatasetId
    if (cur) return
    setActive(list[0]!.dataset_id)
  }, [dq.isLoading, dq.data, searchParams, setActive])

  useEffect(() => {
    const ds = searchParams.get('ds')
    const st = useUiStore.getState()
    if (!dq.isLoading) {
      const list = dq.data ?? []
      if (ds) {
        const exists = list.some((d) => d.dataset_id === ds)
        if (exists && ds !== st.activeDatasetId) setActive(ds)
        else if (!exists && st.activeDatasetId === ds) setActive(null)
      }
    }

    const col = searchParams.get('col')
    if (pathname === '/columns' && col) {
      setSelectedColumn(col)
      setDrawerOpen(true)
    }

    const qParam = searchParams.get('q')
    if (qParam !== null && qParam !== st.columnSearch) setColumnSearch(qParam)

    const sem = searchParams.get('sem')
    if (sem && SEM_VALUES.has(sem) && sem !== st.semanticFilter) setSemantic(sem)

    const sev = searchParams.get('sev')
    if (sev && SEV_VALUES.has(sev) && sev !== st.qualitySeverityFilter) setSev(sev)

    const cq = decodeColumnQuality(searchParams.get('cq'))
    if (cq && cq !== st.columnQualityFilter) setColumnQuality(cq)
  }, [
    dq.isLoading,
    dq.data,
    searchParams,
    pathname,
    setActive,
    setColumnSearch,
    setSemantic,
    setSev,
    setColumnQuality,
    setSelectedColumn,
    setDrawerOpen,
  ])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let dirty = false

    if (activeId) {
      if (next.get('ds') !== activeId) {
        next.set('ds', activeId)
        dirty = true
      }
    } else if (next.has('ds')) {
      next.delete('ds')
      dirty = true
    }

    if (columnSearch) {
      if (next.get('q') !== columnSearch) {
        next.set('q', columnSearch)
        dirty = true
      }
    } else if (next.has('q')) {
      next.delete('q')
      dirty = true
    }

    if (semanticFilter !== 'all') {
      if (next.get('sem') !== semanticFilter) {
        next.set('sem', semanticFilter)
        dirty = true
      }
    } else if (next.has('sem')) {
      next.delete('sem')
      dirty = true
    }

    if (qualitySeverityFilter !== 'all') {
      if (next.get('sev') !== qualitySeverityFilter) {
        next.set('sev', qualitySeverityFilter)
        dirty = true
      }
    } else if (next.has('sev')) {
      next.delete('sev')
      dirty = true
    }

    const cqEnc = encodeColumnQuality(columnQualityFilter)
    if (cqEnc) {
      if (next.get('cq') !== cqEnc) {
        next.set('cq', cqEnc)
        dirty = true
      }
    } else if (next.has('cq')) {
      next.delete('cq')
      dirty = true
    }

    if (pathname === '/columns' && drawerOpen && selectedColumn) {
      if (next.get('col') !== selectedColumn) {
        next.set('col', selectedColumn)
        dirty = true
      }
    } else if (next.has('col')) {
      next.delete('col')
      dirty = true
    }

    if (!dirty) return
    const a = next.toString()
    const b = searchParams.toString()
    if (a !== b) setSearchParams(next, { replace: true })
  }, [
    activeId,
    columnSearch,
    semanticFilter,
    qualitySeverityFilter,
    columnQualityFilter,
    selectedColumn,
    drawerOpen,
    pathname,
    searchParams,
    setSearchParams,
  ])

  return null
}

import { create } from 'zustand'

export type ColumnQualityFilter = 'all' | 'has_flags' | 'critical_only'

type UiState = {
  activeDatasetId: string | null
  setActiveDatasetId: (id: string | null) => void
  activeConversationId: string | null
  setActiveConversationId: (id: string | null) => void
  selectedColumn: string | null
  setSelectedColumn: (c: string | null) => void
  columnDrawerOpen: boolean
  setColumnDrawerOpen: (v: boolean) => void
  columnSearch: string
  setColumnSearch: (s: string) => void
  semanticFilter: string
  setSemanticFilter: (s: string) => void
  qualitySeverityFilter: string
  setQualitySeverityFilter: (s: string) => void
  columnQualityFilter: ColumnQualityFilter
  setColumnQualityFilter: (s: ColumnQualityFilter) => void
  pendingQuery: string | null
  setPendingQuery: (q: string | null) => void
  takePendingQuery: () => string | null
  /** Bumps when a non-null SQL snippet is queued for the editor (same-route navigation). */
  sqlInjectTick: number
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (v: boolean) => void
  shortcutSheetOpen: boolean
  setShortcutSheetOpen: (v: boolean) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  sidebarMobileOpen: boolean
  setSidebarMobileOpen: (v: boolean) => void
  /** Table column ids (accessor keys) hidden in Columns explorer; keyed by dataset id. */
  columnsTableHidden: Record<string, string[]>
  toggleColumnTableVisibility: (datasetId: string, columnId: string) => void
  setColumnsTableHidden: (datasetId: string, ids: string[]) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  activeDatasetId: null,
  setActiveDatasetId: (id) => set({ activeDatasetId: id }),
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  selectedColumn: null,
  setSelectedColumn: (c) => set({ selectedColumn: c }),
  columnDrawerOpen: false,
  setColumnDrawerOpen: (v) => set({ columnDrawerOpen: v }),
  columnSearch: '',
  setColumnSearch: (s) => set({ columnSearch: s }),
  semanticFilter: 'all',
  setSemanticFilter: (s) => set({ semanticFilter: s }),
  qualitySeverityFilter: 'all',
  setQualitySeverityFilter: (s) => set({ qualitySeverityFilter: s }),
  columnQualityFilter: 'all',
  setColumnQualityFilter: (s) => set({ columnQualityFilter: s }),
  pendingQuery: null,
  setPendingQuery: (q) =>
    set((s) => ({
      pendingQuery: q,
      sqlInjectTick: q ? s.sqlInjectTick + 1 : s.sqlInjectTick,
    })),
  takePendingQuery: () => {
    const q = get().pendingQuery
    set({ pendingQuery: null })
    return q
  },
  sqlInjectTick: 0,
  commandPaletteOpen: false,
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
  shortcutSheetOpen: false,
  setShortcutSheetOpen: (v) => set({ shortcutSheetOpen: v }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  sidebarMobileOpen: false,
  setSidebarMobileOpen: (v) => set({ sidebarMobileOpen: v }),
  columnsTableHidden: {},
  toggleColumnTableVisibility: (datasetId, columnId) =>
    set((s) => {
      const cur = s.columnsTableHidden[datasetId] ?? []
      const has = cur.includes(columnId)
      const next = has ? cur.filter((x) => x !== columnId) : [...cur, columnId]
      return {
        columnsTableHidden: { ...s.columnsTableHidden, [datasetId]: next },
      }
    }),
  setColumnsTableHidden: (datasetId, ids) =>
    set((s) => ({
      columnsTableHidden: { ...s.columnsTableHidden, [datasetId]: ids },
    })),
}))

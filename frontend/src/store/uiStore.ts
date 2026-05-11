import { create } from 'zustand'

type UiState = {
  activeDatasetId: string | null
  setActiveDatasetId: (id: string | null) => void
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
}

export const useUiStore = create<UiState>((set) => ({
  activeDatasetId: null,
  setActiveDatasetId: (id) => set({ activeDatasetId: id }),
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
}))

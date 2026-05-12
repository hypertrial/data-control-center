import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { useUiStore } from '@/store/uiStore'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useUiStore.setState({
    activeDatasetId: null,
    activeConversationId: null,
    selectedColumn: null,
    columnDrawerOpen: false,
    columnSearch: '',
    semanticFilter: 'all',
    qualitySeverityFilter: 'all',
    pendingQuery: null,
    sqlInjectTick: 0,
    commandPaletteOpen: false,
    shortcutSheetOpen: false,
    sidebarCollapsed: false,
    sidebarMobileOpen: false,
    columnsTableHidden: {},
  })
})

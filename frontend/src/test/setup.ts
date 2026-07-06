import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { beforeEach } from 'vitest'
import { installConsoleFailGuard } from '@/test/console'
import { useUiStore } from '@/store/uiStore'

installConsoleFailGuard(cleanup)

beforeEach(() => {
  useUiStore.setState({
    activeDatasetId: null,
    activeConversationId: null,
    selectedColumn: null,
    columnDrawerOpen: false,
    columnSearch: '',
    semanticFilter: 'all',
    pendingQuery: null,
    sqlInjectTick: 0,
    commandPaletteOpen: false,
    shortcutSheetOpen: false,
    sidebarCollapsed: false,
    sidebarMobileOpen: false,
    columnsTableHidden: {},
  })
})

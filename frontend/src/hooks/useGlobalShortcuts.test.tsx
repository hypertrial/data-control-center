import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'
import { useUiStore } from '@/store/uiStore'

function Probe({ onClient }: { onClient?: (qc: QueryClient) => void }) {
  useGlobalShortcuts()
  const location = useLocation()
  const qc = useQueryClient()
  onClient?.(qc)
  return (
    <>
      <div data-testid="path">{location.pathname}</div>
      <input id="dcc-sidebar-search" aria-label="sidebar search" />
    </>
  )
}

function wrap(onClient?: (qc: QueryClient) => void) {
  const qc = new QueryClient()
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={qc}>
        <Probe onClient={onClient} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('useGlobalShortcuts', () => {
  it('opens palette, shortcuts, focuses search, navigates, and refreshes', () => {
    const invalidateSpy = vi.fn()
    wrap((qc) => {
      qc.invalidateQueries = invalidateSpy
    })
    useUiStore.setState({ activeDatasetId: 'ds_1' })

    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(useUiStore.getState().commandPaletteOpen).toBe(true)

    fireEvent.keyDown(window, { key: '?' })
    expect(useUiStore.getState().shortcutSheetOpen).toBe(true)

    fireEvent.keyDown(window, { key: '/' })
    expect(screen.getByLabelText('sidebar search')).toHaveFocus()

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'o' })
    expect(screen.getByTestId('path')).toHaveTextContent('/overview')

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByTestId('path')).toHaveTextContent('/ask')

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'h' })
    expect(screen.getByTestId('path')).toHaveTextContent('/charts')

    fireEvent.keyDown(window, { key: 'r' })
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('ignores typing shortcuts in editable targets', () => {
    wrap()
    const input = screen.getByLabelText('sidebar search')
    fireEvent.keyDown(input, { key: '?' })
    expect(useUiStore.getState().shortcutSheetOpen).toBe(false)
  })
})

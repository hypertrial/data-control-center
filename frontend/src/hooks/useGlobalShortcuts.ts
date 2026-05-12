import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '@/store/uiStore'

function targetIsEditable(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return !!el.closest('[contenteditable="true"]')
}

/**
 * Global shortcuts: ⌘/Ctrl+K palette, ? cheatsheet, / sidebar search, g+letter nav, r refresh.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const setPalette = useUiStore((s) => s.setCommandPaletteOpen)
  const setShortcuts = useUiStore((s) => s.setShortcutSheetOpen)
  const activeId = useUiStore((s) => s.activeDatasetId)

  useEffect(() => {
    let gArmed = false
    let gTimer: ReturnType<typeof setTimeout> | null = null

    const clearG = () => {
      gArmed = false
      if (gTimer) clearTimeout(gTimer)
      gTimer = null
    }

    const armG = () => {
      gArmed = true
      if (gTimer) clearTimeout(gTimer)
      gTimer = setTimeout(() => {
        gArmed = false
        gTimer = null
      }, 1400)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const comboK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      if (comboK) {
        e.preventDefault()
        setPalette(true)
        clearG()
        return
      }

      if (e.key === '?' && !targetIsEditable(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setShortcuts(true)
        clearG()
        return
      }

      if (
        e.key === '/' &&
        !targetIsEditable(e.target) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        document.getElementById('dcc-sidebar-search')?.focus()
        clearG()
        return
      }

      if (!targetIsEditable(e.target) && e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        armG()
        return
      }

      if (gArmed && !targetIsEditable(e.target) && !e.metaKey && !e.ctrlKey) {
        const k = e.key.toLowerCase()
        const go = (path: string) => {
          e.preventDefault()
          clearG()
          navigate(path)
        }
        if (k === 'o') go('/')
        else if (k === 'c') go('/columns')
        else if (k === 'q') go('/quality')
        else if (k === 's') go('/samples')
        else if (k === 'a') go('/ask')
        else if (k === 'y') go('/sql')
        return
      }

      if (
        e.key === 'r' &&
        !targetIsEditable(e.target) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        void qc.invalidateQueries()
        if (activeId) {
          void qc.invalidateQueries({ queryKey: ['profile', activeId] })
          void qc.invalidateQueries({ queryKey: ['quality', activeId] })
        }
        clearG()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (gTimer) clearTimeout(gTimer)
    }
  }, [navigate, qc, setPalette, setShortcuts, activeId])
}

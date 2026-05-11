import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'

export function useOpenColumnDrawer() {
  const navigate = useNavigate()
  const location = useLocation()
  const setCol = useUiStore((s) => s.setSelectedColumn)
  const setOpen = useUiStore((s) => s.setColumnDrawerOpen)

  return useCallback(
    (columnName: string) => {
      setCol(columnName)
      setOpen(true)
      if (location.pathname !== '/columns') {
        void navigate({ pathname: '/columns', search: location.search })
      }
    },
    [navigate, location.pathname, location.search, setCol, setOpen],
  )
}

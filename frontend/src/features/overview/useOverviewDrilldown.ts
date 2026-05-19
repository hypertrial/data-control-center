import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'

export function useOverviewDrilldown() {
  const navigate = useNavigate()
  const location = useLocation()
  const setColumnSearch = useUiStore((s) => s.setColumnSearch)
  const setColumnQualityFilter = useUiStore((s) => s.setColumnQualityFilter)

  const goToFlaggedColumns = useCallback(() => {
    setColumnSearch('')
    setColumnQualityFilter('critical_only')
    void navigate({ pathname: '/columns', search: location.search })
  }, [location.search, navigate, setColumnQualityFilter, setColumnSearch])

  return { goToFlaggedColumns }
}

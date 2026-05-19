import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatAnalyticsSql } from '@/lib/sql'
import { useUiStore } from '@/store/uiStore'

/** Navigate to SQL tab and pre-fill the editor (consumed by QueryPage). */
export function useOpenInSql() {
  const navigate = useNavigate()
  const setPending = useUiStore((s) => s.setPendingQuery)

  return useCallback(
    (sql: string) => {
      try {
        setPending(formatAnalyticsSql(sql))
      } catch {
        setPending(sql)
      }
      void navigate('/sql')
    },
    [navigate, setPending],
  )
}

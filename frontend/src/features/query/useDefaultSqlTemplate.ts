import { useEffect, useRef } from 'react'
import { useUiStore } from '@/store/uiStore'
import { formatAnalyticsSql, sqlSelectStarFromView } from '@/lib/sql'

const FALLBACK_SQL = 'select 1;'

function buildTemplate(activeId: string | null, activeViewName: string | undefined): string {
  if (!activeId) return FALLBACK_SQL
  if (!activeViewName) return FALLBACK_SQL
  return sqlSelectStarFromView(activeViewName, 50)
}

export function useDefaultSqlTemplate(
  sqlText: string,
  setSqlText: (next: string) => void,
  activeId: string | null,
  activeViewName: string | undefined,
  sqlInjectTick: number,
) {
  const processedInject = useRef(0)
  const previousTemplate = useRef<string>(FALLBACK_SQL)
  const sqlTextRef = useRef(sqlText)

  useEffect(() => {
    sqlTextRef.current = sqlText
  }, [sqlText])

  useEffect(() => {
    const applyPendingOrTemplate = () => {
      const template = buildTemplate(activeId, activeViewName)
      const current = sqlTextRef.current

      if (sqlInjectTick > processedInject.current) {
        processedInject.current = sqlInjectTick
        const pending = useUiStore.getState().takePendingQuery()
        if (pending) {
          try {
            setSqlText(formatAnalyticsSql(pending))
          } catch {
            setSqlText(pending)
          }
          previousTemplate.current = template
          return
        }
      }

      const trimmed = current.trim()
      const shouldReplace = trimmed.length === 0 || current === previousTemplate.current

      if (shouldReplace && current !== template) {
        setSqlText(template)
      }

      previousTemplate.current = template
    }

    queueMicrotask(applyPendingOrTemplate)
  }, [sqlInjectTick, activeId, activeViewName, setSqlText])
}

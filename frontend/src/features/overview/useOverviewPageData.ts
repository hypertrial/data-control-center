import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { QualityIssue } from '@/api/types'
import { useUiStore } from '@/store/uiStore'

export function useOverviewPageData() {
  const activeId = useUiStore((s) => s.activeDatasetId)

  const q = useQuery({
    queryKey: ['profile', activeId],
    queryFn: () => api.getProfile(activeId!),
    enabled: !!activeId,
  })

  const histQ = useQuery({
    queryKey: ['profile-history', activeId],
    queryFn: () => api.getProfileHistory(activeId!, 10),
    enabled: !!activeId,
  })

  const trend = useMemo(() => {
    const h = histQ.data
    if (!h || h.length < 2) return null
    const a = h[0]?.quality_score
    const b = h[1]?.quality_score
    if (a == null || b == null) return null
    return a - b
  }, [histQ.data])

  const topNull = useMemo(() => {
    const cols = q.data?.column_profiles ?? []
    const sorted = [...cols].sort((a, b) => b.null_pct - a.null_pct).slice(0, 8)
    return {
      names: sorted.map((c) => c.name),
      values: sorted.map((c) => c.null_pct),
    }
  }, [q.data])

  const topIssues = useMemo((): QualityIssue[] => {
    const issues = [...(q.data?.quality_issues ?? [])]
    issues.sort((a, b) => b.score_impact - a.score_impact)
    return issues.slice(0, 5)
  }, [q.data])

  return { activeId, q, histQ, trend, topNull, topIssues }
}

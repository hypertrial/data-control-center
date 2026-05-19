import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { QualityIssue } from '@/api/types'
import {
  computeCompletenessStats,
  rankColumnsByNullPct,
  type CompletenessStats,
} from '@/features/overview/completenessStats'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { useUiStore } from '@/store/uiStore'

export function useOverviewPageData() {
  const activeId = useUiStore((s) => s.activeDatasetId)

  const profile = useDatasetProfile(activeId)
  const q = {
    data: profile.data,
    isLoading: profile.isPendingProfile,
    isError: profile.isError,
    error: profile.error,
    refetch: profile.refetch,
  }

  const histQ = useQuery({
    queryKey: ['profile-history', activeId],
    queryFn: () => api.getProfileHistory(activeId!, 10),
    enabled: !!activeId,
  })

  const hasHistoryTrend = (histQ.data?.length ?? 0) >= 2

  const trend = useMemo(() => {
    const h = histQ.data
    if (!h || h.length < 2) return null
    const a = h[0]?.quality_score
    const b = h[1]?.quality_score
    if (a == null || b == null) return null
    return a - b
  }, [histQ.data])

  const completenessStats = useMemo((): CompletenessStats | null => {
    if (!q.data) return null
    return computeCompletenessStats(q.data)
  }, [q.data])

  const topNullCompact = useMemo(() => {
    const cols = q.data?.column_profiles ?? []
    return rankColumnsByNullPct(cols, 5)
  }, [q.data])

  const topNullFull = useMemo(() => {
    const cols = q.data?.column_profiles ?? []
    return rankColumnsByNullPct(cols, 8)
  }, [q.data])

  const topIssues = useMemo((): QualityIssue[] => {
    const issues = [...(q.data?.quality_issues ?? [])]
    issues.sort((a, b) => b.score_impact - a.score_impact)
    return issues.slice(0, 5)
  }, [q.data])

  return {
    activeId,
    q,
    histQ,
    trend,
    hasHistoryTrend,
    profileUpdatedAt: profile.dataUpdatedAt,
    completenessStats,
    topNullCompact,
    topNullFull,
    topIssues,
  }
}

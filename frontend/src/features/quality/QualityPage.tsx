import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { QualityIssue } from '@/api/types'
import { ActionInSql } from '@/components/ActionInSql'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageContainer, Section } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { useOpenColumnDrawer } from '@/hooks/useOpenColumnDrawer'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const SEV_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 }

const sevVariant = (s: string) => {
  if (s === 'critical') return 'critical' as const
  if (s === 'warning') return 'warning' as const
  return 'info' as const
}

function ImpactBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${pct}%` }} title={`Impact ${value}`} />
    </div>
  )
}

function ExamplesList({ examples }: { examples: unknown[] }) {
  if (!examples.length) return null
  return (
    <div className="space-y-2 text-xs">
      <div className="font-medium text-[hsl(var(--muted))]">Examples</div>
      {examples.map((ex, i) => {
        if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
          return (
            <dl key={i} className="grid gap-1 rounded-md bg-black/30 p-2 font-mono text-[11px]">
              {Object.entries(ex as Record<string, unknown>).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[auto_1fr] gap-x-3">
                  <dt className="text-[hsl(var(--muted))]">{k}</dt>
                  <dd className="truncate text-white/90">{v === null ? 'null' : String(v)}</dd>
                </div>
              ))}
            </dl>
          )
        }
        return (
          <pre key={i} className="overflow-x-auto rounded-md bg-black/30 p-2 text-[11px]">
            {JSON.stringify(ex, null, 2)}
          </pre>
        )
      })}
    </div>
  )
}

function sortIssues(issues: QualityIssue[], mode: 'severity' | 'impact' | 'columns'): QualityIssue[] {
  const copy = [...issues]
  if (mode === 'impact') {
    copy.sort((a, b) => b.score_impact - a.score_impact)
    return copy
  }
  if (mode === 'columns') {
    copy.sort((a, b) => b.affected_columns.length - a.affected_columns.length)
    return copy
  }
  copy.sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.score_impact - a.score_impact,
  )
  return copy
}

function IssueCard({
  issue,
  maxImpact,
  openCol,
}: {
  issue: QualityIssue
  maxImpact: number
  openCol: (c: string) => void
}) {
  return (
    <Card className="border-border-default">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-base font-medium leading-snug">{issue.title}</CardTitle>
          <ImpactBar value={issue.score_impact} max={maxImpact} />
        </div>
        <Badge variant={sevVariant(issue.severity)}>{issue.severity}</Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-[hsl(var(--foreground))]/90">{issue.description}</p>
        <details className="rounded-md border border-border-default bg-white/[0.02] p-3 text-xs">
          <summary className="cursor-pointer font-medium text-[hsl(var(--muted))]">
            Details & suggested actions
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <div className="font-medium text-fg-muted">Why it matters</div>
              <p className="mt-1 text-[hsl(var(--foreground))]/90">{issue.why_it_matters}</p>
            </div>
            {issue.affected_columns.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {issue.affected_columns.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-xs hover:bg-white/10"
                    onClick={() => openCol(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <ExamplesList examples={issue.examples} />
            {issue.suggested_sql ? (
              <div className="flex flex-wrap gap-2">
                <ActionInSql sql={issue.suggested_sql} variant="outline" size="sm">
                  Open in SQL
                </ActionInSql>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(issue.suggested_sql!)
                  }}
                >
                  Copy SQL
                </Button>
              </div>
            ) : null}
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

export function QualityPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const sev = useUiStore((s) => s.qualitySeverityFilter)
  const setSev = useUiStore((s) => s.setQualitySeverityFilter)
  const openCol = useOpenColumnDrawer()
  const [sortMode, setSortMode] = useState<'severity' | 'impact' | 'columns'>('impact')

  const q = useQuery({
    queryKey: ['quality', activeId],
    queryFn: () => api.getQuality(activeId!),
    enabled: !!activeId,
  })

  const profileHook = useDatasetProfile(activeId)
  const profileQ = {
    data: profileHook.data,
    isLoading: profileHook.isPendingProfile,
    isError: profileHook.isError,
    error: profileHook.error,
    refetch: profileHook.refetch,
  }

  const allIssues = useMemo(() => q.data ?? [], [q.data])
  const filtered = sev === 'all' ? allIssues : allIssues.filter((i) => i.severity === sev)
  const sortedFiltered = useMemo(() => sortIssues(filtered, sortMode), [filtered, sortMode])

  const grouped = useMemo(() => {
    const g = {
      critical: sortedFiltered.filter((i) => i.severity === 'critical'),
      warning: sortedFiltered.filter((i) => i.severity === 'warning'),
      info: sortedFiltered.filter((i) => i.severity === 'info'),
    }
    return g
  }, [sortedFiltered])

  const maxImpact = useMemo(
    () => Math.max(1, ...allIssues.map((i) => i.score_impact)),
    [allIssues],
  )

  const score = profileQ.data?.quality_score ?? null
  const colSet = new Set<string>()
  for (const i of allIssues) for (const c of i.affected_columns) colSet.add(c)
  const topCols = [...colSet].slice(0, 6)

  const counts = useMemo(
    () => ({
      all: allIssues.length,
      critical: allIssues.filter((i) => i.severity === 'critical').length,
      warning: allIssues.filter((i) => i.severity === 'warning').length,
      info: allIssues.filter((i) => i.severity === 'info').length,
    }),
    [allIssues],
  )

  if (!activeId) {
    return (
      <PageContainer>
        <p className="text-sm text-[hsl(var(--muted))]">Select a dataset.</p>
      </PageContainer>
    )
  }

  if (q.isLoading || profileQ.isLoading) {
    return (
      <PageContainer>
        <CardSkeleton />
        <CardSkeleton />
      </PageContainer>
    )
  }

  if (q.isError) {
    return (
      <PageContainer>
        <QueryErrorBanner message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <Section title="Quality overview">
        <div className="flex flex-wrap items-baseline gap-3 text-sm">
          <span className="tabular-nums text-2xl font-semibold">{score != null ? score : '—'}</span>
          <span className="text-[hsl(var(--muted))]">{score != null ? '/100 score' : ''}</span>
          <span className="text-white/20">·</span>
          <span>
            {counts.all} issue{counts.all === 1 ? '' : 's'} across {colSet.size} column
            {colSet.size === 1 ? '' : 's'}
          </span>
        </div>
        {topCols.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted))]">Most affected</span>
            <div className="flex flex-wrap gap-1">
              {topCols.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-xs hover:bg-white/10"
                  onClick={() => openCol(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Severity
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['all', `All (${counts.all})`],
                ['critical', `Critical (${counts.critical})`],
                ['warning', `Warning (${counts.warning})`],
                ['info', `Info (${counts.info})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSev(k)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition',
                  sev === k ? 'bg-white/12 text-white' : 'text-[hsl(var(--muted))] hover:bg-white/5',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Sort
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['severity', 'Severity'],
                ['impact', 'Score impact'],
                ['columns', 'Affected cols'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortMode(k)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition',
                  sortMode === k ? 'bg-white/12 text-white' : 'text-[hsl(var(--muted))] hover:bg-white/5',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {sev === 'all' ? (
        (['critical', 'warning', 'info'] as const).map((k) => (
          <section key={k} className="space-y-3">
            <h2 className="text-sm font-semibold capitalize">{k}</h2>
            {grouped[k].length === 0 ? (
              <p className="text-xs text-[hsl(var(--muted))]">No {k} issues.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {grouped[k].map((issue) => (
                  <IssueCard key={issue.id} issue={issue} maxImpact={maxImpact} openCol={openCol} />
                ))}
              </div>
            )}
          </section>
        ))
      ) : sortedFiltered.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted))]">No issues for this filter.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sortedFiltered.map((issue) => (
            <IssueCard key={issue.id} issue={issue} maxImpact={maxImpact} openCol={openCol} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}

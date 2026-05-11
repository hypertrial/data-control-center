import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as echarts from 'echarts'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '@/api/client'
import type { QualityIssue } from '@/api/types'
import { ActionInSql } from '@/components/ActionInSql'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer, Section } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { useOpenColumnDrawer } from '@/hooks/useOpenColumnDrawer'
import { formatBytes, formatCount, formatPercent } from '@/lib/format'
import { qualityScoreSeverity } from '@/lib/tokens'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

function sevBadge(s: string) {
  if (s === 'critical') return 'critical' as const
  if (s === 'warning') return 'warning' as const
  return 'info' as const
}

function HeroMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
}) {
  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums text-white">{value}</div>
        {hint != null && <div className="text-xs text-[hsl(var(--muted))]">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function QualityHero({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return <HeroMetric label="Quality score" value="—" hint="Run refresh after first profile" />
  }
  const sev = qualityScoreSeverity(score)
  const pct = Math.min(100, Math.max(0, score))
  const bar =
    sev === 'critical'
      ? 'bg-[hsl(var(--severity-critical))]'
      : sev === 'warning'
        ? 'bg-[hsl(var(--severity-warning))]'
        : 'bg-[hsl(var(--severity-ok))]'
  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
          Quality score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-1 tabular-nums">
          <span className="text-2xl font-semibold">{score}</span>
          <span className="text-sm text-[hsl(var(--muted))]">/100</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
        </div>
      </CardContent>
    </Card>
  )
}

function MissingnessMiniChart({ names, values }: { names: string[]; values: number[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !names.length) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const chart = echarts.init(ref.current)
    chart.setOption({
      animation: !reduce,
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      yAxis: { type: 'category', data: names, inverse: true, axisLabel: { width: 90, overflow: 'truncate' } },
      series: [
        {
          type: 'bar',
          data: values,
          itemStyle: {
            color: (params: { data: number }) =>
              params.data > 50
                ? 'hsl(var(--severity-critical))'
                : params.data > 20
                  ? 'hsl(var(--severity-warning))'
                  : 'hsl(var(--severity-info))',
          },
        },
      ],
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v.toFixed(2)}%` },
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [names, values])

  if (!names.length) return <p className="text-sm text-[hsl(var(--muted))]">No column stats.</p>

  return <div ref={ref} className="h-64 w-full" role="img" aria-label="Top columns by null percent" />
}

function chipCols(
  label: string,
  cols: string[],
  onPick: (c: string) => void,
): React.ReactNode {
  if (!cols.length) return null
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className="mt-1 min-w-[7rem] text-xs text-[hsl(var(--muted))]">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {cols.map((c) => (
          <button
            key={c}
            type="button"
            className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-0.5 font-mono text-xs text-white/90 hover:bg-white/10"
            onClick={() => onPick(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}

function TopIssueCard({
  issue,
  searchSuffix,
  openCol,
}: {
  issue: QualityIssue
  searchSuffix: string
  openCol: (c: string) => void
}) {
  return (
    <Card className="border-white/10">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium leading-snug">{issue.title}</CardTitle>
        <Badge variant={sevBadge(issue.severity)}>{issue.severity}</Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-1">
          {issue.affected_columns.slice(0, 4).map((c) => (
            <button
              key={c}
              type="button"
              className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono hover:bg-white/10"
              onClick={() => openCol(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={{ pathname: '/quality', search: searchSuffix }}
            className="inline-flex h-8 items-center justify-center rounded-md border border-white/15 bg-transparent px-3 text-xs font-medium hover:bg-white/5"
          >
            Open in Quality
          </Link>
          {issue.suggested_sql ? (
            <ActionInSql sql={issue.suggested_sql} variant="outline" size="sm">
              Insert suggested SQL
            </ActionInSql>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function OverviewPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const location = useLocation()
  const openCol = useOpenColumnDrawer()
  const searchSuffix = location.search.startsWith('?') ? location.search.slice(1) : location.search

  const q = useQuery({
    queryKey: ['profile', activeId],
    queryFn: () => api.getProfile(activeId!),
    enabled: !!activeId,
  })

  const topNull = useMemo(() => {
    const cols = q.data?.column_profiles ?? []
    const sorted = [...cols].sort((a, b) => b.null_pct - a.null_pct).slice(0, 8)
    return {
      names: sorted.map((c) => c.name),
      values: sorted.map((c) => c.null_pct),
    }
  }, [q.data])

  const topIssues = useMemo(() => {
    const issues = [...(q.data?.quality_issues ?? [])]
    issues.sort((a, b) => b.score_impact - a.score_impact)
    return issues.slice(0, 3)
  }, [q.data])

  if (!activeId) {
    return (
      <PageContainer>
        <p className="text-sm text-[hsl(var(--muted))]">Select a dataset from the sidebar.</p>
      </PageContainer>
    )
  }

  if (q.isLoading) {
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

  const p = q.data!
  const typeDots = (
    <>
      <span title="Numeric">{p.numeric_column_count} num</span>
      <span className="text-white/20">·</span>
      <span title="Categorical">{p.categorical_column_count} cat</span>
      <span className="text-white/20">·</span>
      <span title="Datetime">{p.datetime_column_count} dt</span>
    </>
  )

  return (
    <PageContainer>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" title={p.dataset_id}>
          {p.name}
        </h1>
        <p className="mt-1 font-mono text-xs text-[hsl(var(--muted))]" title="Dataset id">
          {p.dataset_id}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroMetric label="Rows" value={formatCount(p.rows)} hint="Since last profile" />
        <HeroMetric label="Columns" value={formatCount(p.columns)} hint={typeDots} />
        <HeroMetric label="File size" value={formatBytes(p.file_size_bytes)} />
        <QualityHero score={p.quality_score} />
      </div>

      <Section title="Dataset story">
        <div className="dcc-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.narrative || '_No narrative._'}</ReactMarkdown>
        </div>
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            At a glance
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="default">{formatPercent(p.missing_cell_pct)} missing cells</Badge>
            <Badge variant="default">
              Duplicate rows (sample) {p.duplicate_row_pct != null ? formatPercent(p.duplicate_row_pct) : '—'}
            </Badge>
            <Badge variant="default">Numeric cols {p.numeric_column_count}</Badge>
            <Badge variant="default">Category cols {p.categorical_column_count}</Badge>
            <Badge variant="default">Datetime cols {p.datetime_column_count}</Badge>
          </div>
        </div>
      </Section>

      <Section title="Structure" description="Inferred grain, time axis, identifiers, and core measures.">
        <div className="space-y-3 text-sm">
          {p.likely_grain && <p className="text-[hsl(var(--foreground))]/90">{p.likely_grain}</p>}
          {p.primary_date_column &&
            chipCols('Primary date', [p.primary_date_column], openCol)}
          {chipCols('Potential IDs', p.potential_id_columns, openCol)}
          {chipCols('Potential keys', p.potential_key_columns, openCol)}
          {chipCols('Main measures', p.main_numeric_measures, openCol)}
        </div>
      </Section>

      <Section
        title="Top quality issues"
        description="Highest score impact first. Jump to columns or apply suggested SQL."
        action={
          <Link
            to={{ pathname: '/quality', search: searchSuffix }}
            className="inline-flex h-8 items-center justify-center rounded-md border border-white/15 bg-transparent px-3 text-xs font-medium hover:bg-white/5"
          >
            All issues
          </Link>
        }
      >
        {topIssues.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted))]">No quality issues detected.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {topIssues.map((issue) => (
              <TopIssueCard key={issue.id} issue={issue} searchSuffix={searchSuffix} openCol={openCol} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Missingness" description="Columns with the highest null rate in the profile sample.">
        <MissingnessMiniChart names={topNull.names} values={topNull.values} />
      </Section>
    </PageContainer>
  )
}

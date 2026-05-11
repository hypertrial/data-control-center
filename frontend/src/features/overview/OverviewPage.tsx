import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as echarts from 'echarts'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { DatasetProfile, QualityIssue } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer, Section } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { useOpenColumnDrawer } from '@/hooks/useOpenColumnDrawer'
import { formatBytes, formatCount, formatPercent } from '@/lib/format'
import { qualityScoreSeverity } from '@/lib/tokens'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

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

function FigureCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('border-white/10', className)}>
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-sm font-semibold leading-tight">{title}</CardTitle>
        {description ? (
          <p className="text-xs leading-snug text-[hsl(var(--muted))]">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

function ColumnMixDonut({
  numeric,
  categorical,
  datetime,
  totalColumns,
}: {
  numeric: number
  categorical: number
  datetime: number
  totalColumns: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const other = Math.max(0, totalColumns - numeric - categorical - datetime)
  const seriesData = useMemo(
    () =>
      [
        { name: 'Numeric', value: numeric },
        { name: 'Categorical', value: categorical },
        { name: 'Datetime', value: datetime },
        ...(other > 0 ? [{ name: 'Other', value: other }] : []),
      ].filter((d) => d.value > 0),
    [numeric, categorical, datetime, other],
  )

  useEffect(() => {
    if (!ref.current) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const chart = echarts.init(ref.current)
    const palette = [
      'hsl(var(--accent))',
      'hsl(var(--severity-info))',
      'hsl(var(--severity-warning))',
      'hsl(var(--muted))',
    ]
    chart.setOption({
      animation: !reduce,
      color: palette,
      tooltip: { trigger: 'item', valueFormatter: (v: number) => `${v} cols` },
      legend: {
        orient: 'horizontal',
        bottom: 0,
        textStyle: { color: 'hsl(var(--muted))', fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '46%'],
          avoidLabelOverlap: true,
          label: { show: true, formatter: '{b}\n{c}', fontSize: 10, color: 'hsl(var(--foreground))' },
          data: seriesData.length
            ? seriesData
            : [{ name: 'No columns', value: 1, itemStyle: { color: 'hsl(var(--muted) / 0.25)' } }],
        },
      ],
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [seriesData])

  if (totalColumns === 0) {
    return <p className="text-sm text-[hsl(var(--muted))]">No column metadata.</p>
  }

  return (
    <div
      ref={ref}
      className="h-56 w-full sm:h-64"
      role="img"
      aria-label="Column types: numeric, categorical, datetime, and other counts"
    />
  )
}

function CompletenessBars({
  missingPct,
  duplicatePct,
}: {
  missingPct: number | null
  duplicatePct: number | null
}) {
  const missing = missingPct != null ? Math.min(100, Math.max(0, missingPct)) : null
  const duplicate = duplicatePct != null ? Math.min(100, Math.max(0, duplicatePct)) : null

  return (
    <div className="flex min-h-[14rem] flex-col justify-center gap-6 px-1 py-2">
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-[hsl(var(--muted))]">Missing cells</span>
          <span className="tabular-nums text-sm font-semibold text-white">
            {missing != null ? formatPercent(missing) : '—'}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              missing != null && missing > 20
                ? 'bg-[hsl(var(--severity-warning))]'
                : 'bg-[hsl(var(--severity-info))]',
            )}
            style={{ width: `${missing ?? 0}%` }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-[hsl(var(--muted))]">Duplicate rows (sample)</span>
          <span className="tabular-nums text-sm font-semibold text-white">
            {duplicate != null ? formatPercent(duplicate) : '—'}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              duplicate != null && duplicate > 5
                ? 'bg-[hsl(var(--severity-warning))]'
                : 'bg-[hsl(var(--severity-ok))]',
            )}
            style={{ width: `${duplicate ?? 0}%` }}
          />
        </div>
      </div>
    </div>
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

function IssuesImpactChart({
  issues,
  openCol,
}: {
  issues: QualityIssue[]
  openCol: (c: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !issues.length) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const chart = echarts.init(ref.current)
    const maxImpact = Math.max(1, ...issues.map((i) => i.score_impact))
    const labels = issues.map((i) => (i.title.length > 48 ? `${i.title.slice(0, 46)}…` : i.title))

    const sevColor = (s: string) =>
      s === 'critical'
        ? 'hsl(var(--severity-critical))'
        : s === 'warning'
          ? 'hsl(var(--severity-warning))'
          : 'hsl(var(--severity-info))'

    chart.setOption({
      animation: !reduce,
      grid: { left: 8, right: 28, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', max: maxImpact * 1.08, splitLine: { lineStyle: { opacity: 0.2 } } },
      yAxis: {
        type: 'category',
        data: labels,
        inverse: true,
        axisLabel: { width: 140, overflow: 'truncate', interval: 0 },
      },
      series: [
        {
          type: 'bar',
          data: issues.map((i) => ({
            value: i.score_impact,
            itemStyle: { color: sevColor(i.severity) },
          })),
        },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (raw: unknown) => {
          const arr = raw as { dataIndex: number }[]
          const row = arr[0]
          if (!row || typeof row.dataIndex !== 'number') return ''
          const issue = issues[row.dataIndex]
          if (!issue) return ''
          const cols = issue.affected_columns.slice(0, 4).join(', ') || '—'
          return `${issue.title}<br/><span style="opacity:.85">Impact</span>: ${issue.score_impact.toFixed(1)}<br/><span style="opacity:.85">Columns</span>: ${cols}`
        },
      },
    })

    const onClick = (p: { dataIndex?: number }) => {
      const idx = typeof p.dataIndex === 'number' ? p.dataIndex : -1
      const issue = idx >= 0 ? issues[idx] : undefined
      const col = issue?.affected_columns[0]
      if (col) openCol(col)
    }
    chart.on('click', onClick)

    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      chart.off('click', onClick)
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [issues, openCol])

  if (!issues.length) {
    return <p className="text-sm text-[hsl(var(--muted))]">No quality issues detected.</p>
  }

  return (
    <div>
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
        Click a bar to open the first affected column
      </p>
      <div
        ref={ref}
        className="h-72 w-full min-h-[16rem]"
        role="img"
        aria-label="Quality issues by score impact"
      />
    </div>
  )
}

function chipCols(
  label: string,
  cols: string[],
  onPick: (c: string) => void,
): React.ReactNode {
  if (!cols.length) return null
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className="mt-1 min-w-[6.5rem] text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
        {label}
      </span>
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

function StructureSummary({ profile, onPick }: { profile: DatasetProfile; onPick: (c: string) => void }) {
  const idCount = profile.potential_id_columns.length
  const keyCount = profile.potential_key_columns.length
  const measureCount = profile.main_numeric_measures.length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Date</div>
          <div className="mt-0.5 truncate font-mono text-xs text-white" title={profile.primary_date_column ?? ''}>
            {profile.primary_date_column ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">IDs</div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{idCount}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Keys</div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{keyCount}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Measures</div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{measureCount}</div>
        </div>
      </div>
      {profile.likely_grain ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Grain</div>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-white/90">{profile.likely_grain}</p>
        </div>
      ) : null}
      <div className="space-y-2.5 border-t border-white/10 pt-3">
        {profile.primary_date_column
          ? chipCols('Primary date', [profile.primary_date_column], onPick)
          : null}
        {chipCols('Potential IDs', profile.potential_id_columns, onPick)}
        {chipCols('Potential keys', profile.potential_key_columns, onPick)}
        {chipCols('Main measures', profile.main_numeric_measures, onPick)}
      </div>
    </div>
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
    return issues.slice(0, 5)
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

      <Section title="Profile snapshot" description="Column mix, completeness, and inferred structure at a glance.">
        <div className="grid gap-3 lg:grid-cols-3">
          <FigureCard
            title="Column mix"
            description="How inferred types split across the schema."
          >
            <ColumnMixDonut
              numeric={p.numeric_column_count}
              categorical={p.categorical_column_count}
              datetime={p.datetime_column_count}
              totalColumns={p.columns}
            />
          </FigureCard>
          <FigureCard
            title="Completeness"
            description="Share of missing cells and sampled duplicate rows."
          >
            <CompletenessBars missingPct={p.missing_cell_pct} duplicatePct={p.duplicate_row_pct} />
          </FigureCard>
          <FigureCard
            title="Structure"
            description="Grain, time axis, identifiers, and core measures."
          >
            <StructureSummary profile={p} onPick={openCol} />
          </FigureCard>
        </div>
      </Section>

      <Section
        title="Quality focus"
        description="Largest score drivers and columns with the most nulls in the profile sample."
        action={
          <Link
            to={{ pathname: '/quality', search: searchSuffix }}
            className="inline-flex h-8 items-center justify-center rounded-md border border-white/15 bg-transparent px-3 text-xs font-medium hover:bg-white/5"
          >
            All issues
          </Link>
        }
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <FigureCard title="Issue impact" description="Highest score impact first (max five).">
            <IssuesImpactChart issues={topIssues} openCol={openCol} />
          </FigureCard>
          <FigureCard
            title="Top null rates"
            description="Columns with the highest null percentage."
          >
            <MissingnessMiniChart names={topNull.names} values={topNull.values} />
          </FigureCard>
        </div>
      </Section>
    </PageContainer>
  )
}

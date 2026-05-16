import type { ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { api } from '@/api/client'
import type { DatasetProfile, QualityIssue } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageContainer, Section } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { useOpenColumnDrawer } from '@/hooks/useOpenColumnDrawer'
import { formatBytes, formatCount, formatPercent } from '@/lib/format'
import { qualityScoreSeverity } from '@/lib/tokens'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { hslFromRootVar, chartAxisLabelStyle, chartPalette, chartTooltip } from '@/lib/chartTheme'
import { ProfileDiffDialog } from '@/features/overview/DiffDialog'

/** Truncate for chart axis labels; full string remains in tooltips. */
function shortenChartLabel(raw: string, maxChars: number): string {
  const s = raw.trim()
  if (s.length <= maxChars) return s
  return `${s.slice(0, Math.max(1, maxChars - 1))}…`
}

function estimateChartYAxisGutterPx(names: string[], cap = 300): number {
  const longest = names.reduce((m, n) => Math.max(m, n.length), 10)
  return Math.min(cap, Math.round(48 + longest * 6.5))
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
    <Card className="border-border-default">
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

function QualityHero({
  score,
  trend,
}: {
  score: number | null | undefined
  trend?: number | null
}) {
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
    <Card className="border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
          Quality score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-semibold">{score}</span>
          <span className="text-sm text-[hsl(var(--muted))]">/100</span>
          {trend != null && Number.isFinite(trend) && Math.abs(trend) >= 0.05 ? (
            <span
              className={cn(
                'text-xs font-medium',
                trend > 0 ? 'text-[hsl(var(--severity-ok))]' : 'text-[hsl(var(--severity-critical))]',
              )}
              title="Change vs previous profile snapshot"
            >
              {trend > 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}
            </span>
          ) : null}
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
    <Card className={cn('border-border-default flex h-full min-w-0 flex-col overflow-hidden', className)}>
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-sm font-semibold leading-tight">{title}</CardTitle>
        {description ? (
          <p className="text-xs leading-snug text-[hsl(var(--muted))]">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-0">{children}</CardContent>
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

  useDisposableEChart(
    ref,
    totalColumns > 0,
    () => {
      const pal = chartPalette()
      return {
        color: pal,
        tooltip: { trigger: 'item' as const, valueFormatter: (v: number) => `${v} cols`, ...chartTooltip() },
        legend: {
          orient: 'horizontal' as const,
          bottom: 0,
          textStyle: { color: hslFromRootVar('--muted'), fontSize: 11 },
        },
        series: [
          {
            type: 'pie',
            radius: ['45%', '72%'],
            center: ['50%', '46%'],
            avoidLabelOverlap: true,
            label: {
              show: true,
              formatter: '{b}\n{c}',
              fontSize: 10,
              color: hslFromRootVar('--foreground'),
            },
            data: seriesData.length
              ? seriesData
              : [{ name: 'No columns', value: 1, itemStyle: { color: hslFromRootVar('--muted', 0.28) } }],
          },
        ],
      }
    },
    [seriesData],
  )

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
  const leftGutter = useMemo(() => estimateChartYAxisGutterPx(names), [names])

  useDisposableEChart(
    ref,
    names.length > 0,
    () => {
      const crit = hslFromRootVar('--severity-critical')
      const warn = hslFromRootVar('--severity-warning')
      const info = hslFromRootVar('--severity-info')
      return {
        grid: {
          left: leftGutter,
          right: 20,
          top: 16,
          bottom: 8,
          containLabel: false,
        },
        xAxis: {
          type: 'value',
          max: 100,
          axisLabel: { formatter: '{value}%', ...chartAxisLabelStyle() },
        },
        yAxis: {
          type: 'category',
          data: names,
          inverse: true,
          axisLabel: {
            ...chartAxisLabelStyle(),
            interval: 0,
            width: Math.max(96, leftGutter - 20),
            overflow: 'truncate',
            formatter: (v: string) => shortenChartLabel(v, 44),
          },
        },
        series: [
          {
            type: 'bar',
            data: values,
            itemStyle: {
              color: (params: { data: number }) =>
                params.data > 50 ? crit : params.data > 20 ? warn : info,
            },
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (raw: unknown) => {
            const arr = raw as { dataIndex?: number; name?: string }[]
            const row = arr[0]
            const ix = typeof row?.dataIndex === 'number' ? row.dataIndex : -1
            const col = ix >= 0 ? names[ix] : row?.name ?? ''
            const pct = ix >= 0 ? values[ix] : null
            const pctStr = pct != null ? `${pct.toFixed(2)}% null` : ''
            return col ? `${col}<br/><span style="opacity:.85">${pctStr}</span>` : pctStr
          },
          ...chartTooltip(),
        },
      }
    },
    [names, values, leftGutter],
  )

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
  const labels = useMemo(() => issues.map((i) => i.title), [issues])
  const leftGutter = useMemo(() => estimateChartYAxisGutterPx(labels, 340), [labels])

  useDisposableEChart(
    ref,
    issues.length > 0,
    () => {
      const maxImpact = Math.max(1, ...issues.map((i) => i.score_impact))

      const crit = hslFromRootVar('--severity-critical')
      const warn = hslFromRootVar('--severity-warning')
      const info = hslFromRootVar('--severity-info')
      const sevColor = (s: string) => (s === 'critical' ? crit : s === 'warning' ? warn : info)

      return {
        grid: {
          left: leftGutter,
          right: 28,
          top: 16,
          bottom: 8,
          containLabel: false,
        },
        xAxis: {
          type: 'value',
          max: maxImpact * 1.08,
          splitLine: { lineStyle: { opacity: 0.2 } },
          axisLabel: { ...chartAxisLabelStyle() },
        },
        yAxis: {
          type: 'category',
          data: labels,
          inverse: true,
          axisLabel: {
            ...chartAxisLabelStyle(),
            interval: 0,
            width: Math.max(120, leftGutter - 24),
            overflow: 'truncate',
            formatter: (v: string) => shortenChartLabel(v, 52),
          },
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
          ...chartTooltip(),
        },
      }
    },
    [issues, labels, leftGutter],
    (chart) => {
      const onClick = (p: { dataIndex?: number }) => {
        const idx = typeof p.dataIndex === 'number' ? p.dataIndex : -1
        const issue = idx >= 0 ? issues[idx] : undefined
        const col = issue?.affected_columns[0]
        if (col) openCol(col)
      }
      chart.on('click', onClick)
      return () => chart.off('click', onClick)
    },
  )

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
  opts?: { maxItems?: number },
): React.ReactNode {
  if (!cols.length) return null
  const max = opts?.maxItems
  const shown = max != null ? cols.slice(0, max) : cols
  const overflow = max != null ? cols.slice(max) : []
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <span className="mt-1 min-w-[6.5rem] shrink-0 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {shown.map((c) => (
          <button
            key={c}
            type="button"
            className="max-w-full truncate rounded-md border border-border-default bg-white/[0.04] px-2 py-0.5 text-left font-mono text-xs text-white/90 hover:bg-white/10"
            title={c}
            onClick={() => onPick(c)}
          >
            {c}
          </button>
        ))}
        {overflow.length > 0 ? (
          <span
            className="self-center rounded-md border border-border-default bg-white/[0.03] px-2 py-0.5 text-xs text-[hsl(var(--muted))]"
            title={overflow.join(', ')}
          >
            +{overflow.length} more
          </span>
        ) : null}
      </div>
    </div>
  )
}

function StructureSummary({ profile, onPick }: { profile: DatasetProfile; onPick: (c: string) => void }) {
  const idCols = profile.entity_id_columns.length
    ? profile.entity_id_columns.map((x) => x.name)
    : profile.potential_id_columns
  const keyCols = profile.primary_grain_key_columns.length
    ? profile.primary_grain_key_columns
    : profile.potential_key_columns
  const measureCols = profile.measure_candidates.length
    ? profile.measure_candidates.map((x) => x.name)
    : profile.main_numeric_measures
  const dateLabel = profile.primary_temporal_column?.name ?? profile.primary_date_column
  const dateKind = profile.primary_temporal_column?.kind
  const dateHint = dateKind === 'discrete_period' ? 'discrete period' : dateKind === 'continuous_datetime' ? 'datetime' : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center sm:text-left">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Date</div>
          <div className="mt-0.5 min-w-0 space-y-0.5">
            <div className="break-words font-mono text-xs leading-snug text-white" title={dateLabel ?? ''}>
              {dateLabel ?? '—'}
            </div>
            {dateHint ? (
              <div className="text-[10px] leading-snug text-[hsl(var(--muted))]" title={dateHint}>
                {dateHint}
              </div>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Entities
          </div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{idCols.length}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Grain cols
          </div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{keyCols.length}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Measures</div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{measureCols.length}</div>
        </div>
      </div>
      {profile.likely_grain ? (
        <div className="rounded-lg border border-border-default bg-white/[0.02] px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Grain (natural language)
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-white/90">{profile.likely_grain}</p>
        </div>
      ) : null}
      {profile.structure_warnings.length ? (
        <div
          className="rounded-lg border border-border-default bg-white/[0.02] px-3 py-2"
          title={profile.structure_warnings.join('\n')}
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Inference notes</div>
          <ul className="mt-1 space-y-1 text-xs text-white/85">
            {profile.structure_warnings.slice(0, 2).map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-2.5 border-t border-border-default pt-3">
        {dateLabel
          ? chipCols('Primary date', [dateLabel], onPick)
          : null}
        {chipCols('Entity IDs', idCols, onPick)}
        {chipCols('Row grain', keyCols, onPick)}
        {chipCols('Main measures', measureCols, onPick, { maxItems: 8 })}
      </div>
    </div>
  )
}

export function OverviewPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const location = useLocation()
  const openCol = useOpenColumnDrawer()
  const searchSuffix = location.search.startsWith('?') ? location.search.slice(1) : location.search
  const [diffOpen, setDiffOpen] = useState(false)

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroMetric label="Rows" value={formatCount(p.rows)} hint="Since last profile" />
        <HeroMetric label="Columns" value={formatCount(p.columns)} hint={typeDots} />
        <HeroMetric label="File size" value={formatBytes(p.file_size_bytes)} />
        <QualityHero score={p.quality_score} trend={trend} />
      </div>

      <Section title="Profile snapshot" description="Column mix, completeness, and inferred structure at a glance.">
        <div className="grid gap-3 md:grid-cols-2 md:items-stretch">
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
        </div>
        <div className="mt-3 min-w-0">
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDiffOpen(true)}>
              What changed?
            </Button>
            <Link
              to={{ pathname: '/quality', search: searchSuffix }}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border-default bg-transparent px-3 text-xs font-medium hover:bg-white/5"
            >
              All issues
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
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
      <ProfileDiffDialog datasetId={activeId} open={diffOpen} onOpenChange={setDiffOpen} />
    </PageContainer>
  )
}

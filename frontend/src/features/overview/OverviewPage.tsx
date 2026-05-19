import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageContainer, Section } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { useOpenColumnDrawer } from '@/hooks/useOpenColumnDrawer'
import { formatBytes, formatCount } from '@/lib/format'
import { ProfileDiffDialog } from '@/features/overview/DiffDialog'
import { ColumnMixDonut } from '@/features/overview/ColumnMixDonut'
import { CompletenessBars } from '@/features/overview/CompletenessBars'
import { IssuesImpactChart } from '@/features/overview/IssuesImpactChart'
import { MissingnessMiniChart } from '@/features/overview/MissingnessMiniChart'
import { FigureCard } from '@/features/overview/OverviewFigureCard'
import { HeroMetric, QualityHero } from '@/features/overview/OverviewHeroMetrics'
import { StructureSummary } from '@/features/overview/StructureSummary'
import { useOverviewPageData } from '@/features/overview/useOverviewPageData'

export function OverviewPage() {
  const location = useLocation()
  const openCol = useOpenColumnDrawer()
  const searchSuffix = location.search.startsWith('?') ? location.search.slice(1) : location.search
  const [diffOpen, setDiffOpen] = useState(false)

  const { activeId, q, trend, topNull, topIssues } = useOverviewPageData()

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
            description={
              p.duplicate_row_pct_scope === 'sample'
                ? 'Share of missing cells and duplicate rows in the profiler sample.'
                : 'Share of missing cells and duplicate rows.'
            }
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

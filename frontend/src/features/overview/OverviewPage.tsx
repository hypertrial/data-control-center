import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowRight,
  BarChart3,
  Check,
  DatabaseZap,
  Eye,
  Loader2,
  MessageCircle,
  Rows3,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { DatasetRelationship, RelationshipVerification } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { PageContainer, Section } from '@/components/ui/section'
import { CardSkeleton } from '@/components/ui/skeleton'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { formatBytes, formatCount, formatDatasetFormat } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'

function relationshipLabel(relationship: DatasetRelationship): string {
  return `${relationship.left.dataset_name}.${relationship.left.column_name} → ${relationship.right.dataset_name}.${relationship.right.column_name}`
}

function RelationshipsCard({ activeId }: { activeId: string }) {
  const qc = useQueryClient()
  const openInSql = useOpenInSql()
  const [verification, setVerification] = useState<Record<string, RelationshipVerification>>({})
  const query = useQuery({
    queryKey: ['relationships', activeId, true],
    queryFn: () => api.listRelationships(activeId, true),
    refetchInterval: (state) => (state.state.data?.pending_dataset_ids.length ? 2_000 : false),
  })
  const verify = useMutation({
    mutationFn: api.verifyRelationship,
    onSuccess: (result) =>
      setVerification((current) => ({ ...current, [result.relationship_id]: result })),
    onError: (error) => toast.error((error as Error).message),
  })
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'dismissed' }) =>
      api.setRelationshipDecision(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['relationships'] }),
    onError: (error) => toast.error((error as Error).message),
  })
  const restore = useMutation({
    mutationFn: api.deleteRelationshipDecision,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['relationships'] }),
    onError: (error) => toast.error((error as Error).message),
  })

  if (query.isError) {
    return <QueryErrorBanner message={(query.error as Error).message} onRetry={() => void query.refetch()} />
  }

  const relationships = query.data?.relationships ?? []
  const visible = relationships.filter((item) => item.decision !== 'dismissed')
  const dismissed = relationships.filter((item) => item.decision === 'dismissed')

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-fg-muted" aria-hidden />
            Relationships
          </CardTitle>
          <p className="mt-1 text-xs text-fg-muted">Conservative suggestions from cached column profiles.</p>
        </div>
        {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-label="Refreshing relationships" /> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {query.data?.pending_dataset_ids.length ? (
          <p className="rounded-md border border-border-default bg-white/[0.03] p-3 text-xs text-fg-muted">
            Waiting for {query.data.pending_dataset_ids.length} dataset profile(s) before checking every relationship.
          </p>
        ) : null}
        {query.isLoading ? (
          <p className="text-sm text-fg-muted">Loading relationships…</p>
        ) : !visible.length ? (
          <p className="text-sm text-fg-muted">No suggested relationships found yet.</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((relationship) => {
              const result = verification[relationship.relationship_id]
              const stale = relationship.availability === 'stale'
              return (
                <li key={relationship.relationship_id} className="rounded-lg border border-border-default bg-black/15 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-fg">{relationshipLabel(relationship)}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant={relationship.decision === 'confirmed' ? 'ok' : 'default'}>
                          {relationship.decision}
                        </Badge>
                        <Badge>{relationship.confidence} confidence</Badge>
                        <Badge>{relationship.cardinality.replaceAll('_', ' ')}</Badge>
                        {stale ? <Badge variant="warning">stale</Badge> : null}
                      </div>
                      {relationship.reasons.length ? (
                        <p className="mt-2 text-xs text-fg-muted">{relationship.reasons.join(' · ')}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={stale || verify.isPending}
                        onClick={() => verify.mutate(relationship.relationship_id)}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> Verify
                      </Button>
                      {relationship.decision === 'suggested' ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={stale || decide.isPending}
                            onClick={() => decide.mutate({ id: relationship.relationship_id, status: 'confirmed' })}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Confirm
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: relationship.relationship_id, status: 'dismissed' })}
                          >
                            <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Dismiss
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(relationship.relationship_id)}
                        >
                          Restore suggestion
                        </Button>
                      )}
                    </div>
                  </div>
                  {result ? (
                    <p className="mt-2 text-xs text-fg-muted">
                      <span className="font-medium capitalize text-fg">{result.verdict.replace('_', ' ')}</span>
                      {' · '}{result.overlap_distinct} shared values · {result.left_match_pct}% / {result.right_match_pct}% coverage
                    </p>
                  ) : null}
                  {relationship.suggested_sql ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => openInSql(relationship.suggested_sql!)}
                    >
                      <Terminal className="mr-1 h-3.5 w-3.5" aria-hidden /> Open join SQL
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {dismissed.length ? (
          <details className="rounded-md border border-border-default px-3 py-2 text-sm">
            <summary className="cursor-pointer text-fg-muted">Dismissed ({dismissed.length})</summary>
            <ul className="mt-2 space-y-2">
              {dismissed.map((relationship) => (
                <li key={relationship.relationship_id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-fg-muted">{relationshipLabel(relationship)}</span>
                  <Button variant="ghost" size="sm" onClick={() => restore.mutate(relationship.relationship_id)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function OverviewPage() {
  const navigate = useNavigate()
  const openInSql = useOpenInSql()
  const activeId = useUiStore((state) => state.activeDatasetId)
  const setPendingAskQuestion = useUiStore((state) => state.setPendingAskQuestion)
  const [showAllIssues, setShowAllIssues] = useState(false)
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const profile = useDatasetProfile(activeId)
  const savedCharts = useQuery({
    queryKey: ['saved-charts', activeId],
    queryFn: () => api.listSavedCharts(activeId),
    enabled: !!activeId,
  })
  const summary = useMemo(
    () => datasets.data?.find((dataset) => dataset.dataset_id === activeId),
    [activeId, datasets.data],
  )

  if (!activeId) return <PageContainer><p className="text-sm text-fg-muted">Select a dataset.</p></PageContainer>
  if (datasets.isLoading) {
    return <PageContainer><CardSkeleton /><CardSkeleton /><CardSkeleton /></PageContainer>
  }
  if (datasets.isError || profile.isError) {
    const query = datasets.isError ? datasets : profile
    return (
      <PageContainer>
        <QueryErrorBanner message={(query.error as Error).message} onRetry={() => void query.refetch()} />
      </PageContainer>
    )
  }
  if (!profile.data) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Loader2 className="h-5 w-5 animate-spin text-fg-muted" aria-hidden />
            <div>
              <p className="text-sm font-medium">Profiling dataset…</p>
              <p className="mt-1 text-xs text-fg-muted">
                Overview will fill in automatically when the cached profile is ready
                {profile.jobProgress != null ? ` (${Math.round(profile.jobProgress * 100)}%)` : ''}.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  const data = profile.data
  const issues = [...data.quality_issues].sort((a, b) => b.score_impact - a.score_impact)
  const shownIssues = showAllIssues ? issues : issues.slice(0, 3)
  const grainKeys = new Set(data.primary_grain_key_columns)
  const go = (path: string, extras?: Record<string, string>) => {
    const params = new URLSearchParams({ ds: activeId, ...extras })
    navigate(`${path}?${params}`)
  }

  return (
    <PageContainer className="mx-auto w-full max-w-7xl">
      <Section
        title="Overview"
        description="Understand the dataset, address the highest-impact issues, and continue with a useful next step."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-fg-muted" /> What this dataset is</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="prose prose-invert prose-sm max-w-none text-fg-muted [&_strong]:text-fg">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.narrative || 'Profile complete. Use the structure summary below to begin exploring.'}</ReactMarkdown>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs text-fg-muted">Shape</dt><dd className="mt-1 font-medium">{formatCount(data.rows)} rows × {formatCount(data.columns)} columns</dd></div>
                <div><dt className="text-xs text-fg-muted">Format</dt><dd className="mt-1 font-medium">{formatDatasetFormat(summary?.format ?? '')} · {formatBytes(data.file_size_bytes)}</dd></div>
                <div><dt className="text-xs text-fg-muted">Likely grain</dt><dd className="mt-1 font-medium">{data.likely_grain || 'Not confidently detected'}</dd></div>
                <div><dt className="text-xs text-fg-muted">Profile scope</dt><dd className="mt-1 font-medium">{data.profiler_sample_rows && data.profiler_sample_rows < data.rows ? `${formatCount(data.profiler_sample_rows)} sampled rows` : 'Full dataset'}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {data.primary_grain_key_columns.map((name) => <Badge key={`key-${name}`}>Key: {name}</Badge>)}
                {data.entity_id_columns.filter((column) => !grainKeys.has(column.name)).slice(0, 4).map((column) => <Badge key={`id-${column.name}`}>Identifier: {column.name}</Badge>)}
                {data.temporal_columns.slice(0, 3).map((column) => <Badge key={`time-${column.name}`}>Time: {column.name}</Badge>)}
                {data.main_numeric_measures.slice(0, 4).map((name) => <Badge key={`measure-${name}`}>Measure: {name}</Badge>)}
              </div>
              {[...(data.profile_metric_warnings ?? []), ...data.structure_warnings].length ? (
                <ul className="space-y-1 rounded-md border border-border-default bg-white/[0.03] p-3 text-xs text-fg-muted">
                  {[...(data.profile_metric_warnings ?? []), ...data.structure_warnings].map((warning) => <li key={warning}>• {warning}</li>)}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ArrowRight className="h-4 w-4 text-fg-muted" /> Next actions</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              <Button variant="outline" className="justify-start" onClick={() => go('/samples')}><Rows3 className="mr-2 h-4 w-4" /> Browse rows</Button>
              <Button variant="outline" className="justify-start" onClick={() => go('/charts')}><BarChart3 className="mr-2 h-4 w-4" /> Build a recommended chart</Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => {
                  setPendingAskQuestion(`What are the most important patterns and quality concerns in ${data.name}?`)
                  go('/ask')
                }}
              ><MessageCircle className="mr-2 h-4 w-4" /> Ask about this dataset</Button>
              {issues[0]?.suggested_sql ? (
                <Button variant="outline" className="justify-start" onClick={() => openInSql(issues[0]!.suggested_sql!)}><Terminal className="mr-2 h-4 w-4" /> Investigate the top issue in SQL</Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-fg-muted" /> Health</CardTitle>
              <p className="mt-1 text-xs text-fg-muted">Quality is 100 minus issue impacts, clamped to 0–100.</p>
            </div>
            <div className="text-right"><div className="text-3xl font-semibold tabular-nums">{data.quality_score == null ? '—' : Math.round(data.quality_score)}</div><div className="text-xs text-fg-muted">quality score</div></div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!shownIssues.length ? <p className="text-sm text-fg-muted">No profile quality issues were detected.</p> : (
              shownIssues.map((issue) => (
                <article key={issue.id} className="rounded-lg border border-border-default bg-black/15 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-medium">{issue.title}</h3><p className="mt-1 text-sm text-fg-muted">{issue.description}</p></div><Badge variant={issue.severity}>{issue.score_impact ? `−${issue.score_impact}` : issue.severity}</Badge></div>
                  <p className="mt-2 text-xs text-fg-muted"><span className="font-medium text-fg">Why it matters:</span> {issue.why_it_matters}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{issue.affected_columns.map((column) => <Badge key={column}>{column}</Badge>)}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {issue.affected_columns.length === 1 ? <Button variant="ghost" size="sm" onClick={() => go('/columns', { col: issue.affected_columns[0]! })}>View column</Button> : null}
                    {issue.affected_columns.length > 1 ? <Button variant="ghost" size="sm" onClick={() => go('/columns', { cq: 'flags' })}>View flagged columns</Button> : null}
                    <Button variant="ghost" size="sm" onClick={() => go('/samples')}>Browse samples</Button>
                    {issue.suggested_sql ? <Button variant="ghost" size="sm" onClick={() => openInSql(issue.suggested_sql!)}>Open suggested SQL</Button> : null}
                  </div>
                </article>
              ))
            )}
            {issues.length > 3 ? <Button variant="ghost" size="sm" onClick={() => setShowAllIssues((value) => !value)}>{showAllIssues ? 'Show top issues' : `Show all ${issues.length} issues`}</Button> : null}
          </CardContent>
        </Card>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <RelationshipsCard activeId={activeId} />
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-fg-muted" /> Saved charts</CardTitle></CardHeader>
          <CardContent>
            {savedCharts.isError ? <QueryErrorBanner message={(savedCharts.error as Error).message} onRetry={() => void savedCharts.refetch()} /> : null}
            {savedCharts.isLoading ? <p className="text-sm text-fg-muted">Loading saved charts…</p> : null}
            {!savedCharts.isLoading && !savedCharts.isError && !savedCharts.data?.length ? <p className="text-sm text-fg-muted">No charts saved for this dataset yet.</p> : null}
            <ul className="space-y-2">
              {(savedCharts.data ?? []).slice(0, 5).map((chart) => (
                <li key={chart.chart_id} className="flex items-center justify-between gap-3 rounded-md border border-border-default px-3 py-2">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{chart.name}</p>{chart.description ? <p className="truncate text-xs text-fg-muted">{chart.description}</p> : null}</div>
                  <Button variant="ghost" size="sm" onClick={() => go('/charts', { chart: chart.chart_id })}>Open</Button>
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => go('/charts')}>View all charts</Button>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

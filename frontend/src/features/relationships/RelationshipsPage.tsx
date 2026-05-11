import { RefreshCw } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { RelationshipCandidate } from '@/api/types'
import { ActionInSql } from '@/components/ActionInSql'
import { Button } from '@/components/ui/button'
import { PageContainer, Section } from '@/components/ui/section'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useDisposableEChart } from '@/hooks/useDisposableEChart'
import { sqlJoinPreviewSnippet } from '@/lib/sql'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

type Scope = 'active' | 'all'

function pairKey(r: RelationshipCandidate) {
  const a = `${r.left_dataset_id}`
  const b = `${r.right_dataset_id}`
  return a < b ? `${a}||${b}` : `${b}||${a}`
}

function pairLabel(r: RelationshipCandidate) {
  const a = r.left_dataset_id
  const b = r.right_dataset_id
  return a < b ? `${a} ↔ ${b}` : `${b} ↔ ${a}`
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0
  return (
    <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function RelationshipsPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const qc = useQueryClient()
  const [scope, setScope] = useState<Scope>('active')
  const [view, setView] = useState<'table' | 'graph'>('table')
  const [refreshBusy, setRefreshBusy] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)

  const q = useQuery({
    queryKey: ['relationships'],
    queryFn: api.relationships,
  })

  const rows = useMemo(() => {
    const all = q.data ?? []
    if (scope === 'all' || !activeId) return all
    return all.filter((r) => r.left_dataset_id === activeId || r.right_dataset_id === activeId)
  }, [q.data, scope, activeId])

  const maxScore = useMemo(() => Math.max(1, ...rows.map((r) => r.score)), [rows])

  const grouped = useMemo(() => {
    const m = new Map<string, RelationshipCandidate[]>()
    for (const r of rows) {
      const k = pairKey(r)
      const cur = m.get(k) ?? []
      cur.push(r)
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  useDisposableEChart(
    chartRef,
    view === 'graph' && rows.length > 0,
    () => {
      const nodes = new Map<string, number>()
      let idx = 0
      for (const r of rows) {
        if (!nodes.has(r.left_dataset_id)) nodes.set(r.left_dataset_id, idx++)
        if (!nodes.has(r.right_dataset_id)) nodes.set(r.right_dataset_id, idx++)
      }
      const nodeArr = [...nodes.keys()].map((name) => ({
        id: String(nodes.get(name)),
        name,
        symbolSize: 28,
        label: { show: true, fontSize: 10 },
      }))
      const links = rows.map((r) => ({
        source: String(nodes.get(r.left_dataset_id)),
        target: String(nodes.get(r.right_dataset_id)),
        value: r.score,
        lineStyle: { width: 1 + r.score },
      }))
      return {
        tooltip: {},
        series: [
          {
            type: 'graph',
            layout: 'force',
            roam: true,
            label: { show: true, position: 'right' },
            data: nodeArr,
            edges: links,
            force: { repulsion: 200, edgeLength: [40, 120] },
            lineStyle: { curveness: 0.1, opacity: 0.7 },
          },
        ],
      }
    },
    [rows, view],
  )

  if (q.isLoading) {
    return (
      <PageContainer>
        <p className="text-sm text-[hsl(var(--muted))]">Loading relationships…</p>
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
      <Section
        title="Relationships"
        description="Heuristic join candidates from name similarity and sampled value overlap."
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Scope
          </span>
          <button
            type="button"
            onClick={() => setScope('active')}
            disabled={!activeId}
            className={cn(
              'rounded-full px-3 py-1 text-xs transition',
              scope === 'active' ? 'bg-white/12 text-white' : 'text-[hsl(var(--muted))] hover:bg-white/5',
              !activeId && 'opacity-40',
            )}
          >
            Involving active dataset
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={cn(
              'rounded-full px-3 py-1 text-xs transition',
              scope === 'all' ? 'bg-white/12 text-white' : 'text-[hsl(var(--muted))] hover:bg-white/5',
            )}
          >
            All workspace
          </button>
          <span className="mx-2 text-white/15">·</span>
          <button
            type="button"
            onClick={() => setView('table')}
            className={cn(
              'rounded-full px-3 py-1 text-xs transition',
              view === 'table' ? 'bg-white/12 text-white' : 'text-[hsl(var(--muted))] hover:bg-white/5',
            )}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setView('graph')}
            className={cn(
              'rounded-full px-3 py-1 text-xs transition',
              view === 'graph' ? 'bg-white/12 text-white' : 'text-[hsl(var(--muted))] hover:bg-white/5',
            )}
          >
            Graph
          </button>
          <span className="mx-2 text-white/15">·</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => {
              setRefreshBusy(true)
              void api
                .refreshRelationships()
                .then(() => void qc.invalidateQueries({ queryKey: ['relationships'] }))
                .finally(() => setRefreshBusy(false))
            }}
            disabled={q.isFetching || refreshBusy}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (q.isFetching || refreshBusy) && 'animate-spin')} />
            Refresh discovery
          </Button>
        </div>
      </Section>

      {view === 'graph' ? (
        rows.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted))]">Not enough data to draw a graph for this scope.</p>
        ) : (
          <div
            ref={chartRef}
            className="h-[420px] w-full rounded-xl border border-white/10"
            role="img"
            aria-label="Relationship graph"
          />
        )
      ) : rows.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted))]">
          {scope === 'active' && !activeId
            ? 'Select a dataset to see join candidates involving it, or choose “All workspace”.'
            : 'No relationship candidates for this scope.'}
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([key, list]) => (
            <section key={key} className="space-y-2">
              <h2 className="text-sm font-semibold text-white/90">{pairLabel(list[0]!)}</h2>
              <Table>
                <caption className="sr-only">Join candidates for {pairLabel(list[0]!)}</caption>
                <THead>
                  <TR>
                    <TH scope="col">Left</TH>
                    <TH scope="col">Right</TH>
                    <TH scope="col">Score</TH>
                    <TH scope="col">Evidence</TH>
                    <TH scope="col">SQL</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((r, i) => {
                    const sqlSnippet = sqlJoinPreviewSnippet(
                      r.left_dataset_id,
                      r.left_column,
                      r.right_dataset_id,
                      r.right_column,
                      100,
                    )
                    return (
                      <TR key={`${r.left_dataset_id}-${r.left_column}-${r.right_dataset_id}-${r.right_column}-${i}`}>
                        <TD className="font-mono text-xs">
                          {r.left_dataset_id}.{r.left_column}
                        </TD>
                        <TD className="font-mono text-xs">
                          {r.right_dataset_id}.{r.right_column}
                        </TD>
                        <TD>
                          <div className="flex items-center gap-2 tabular-nums">
                            <ScoreBar score={r.score} max={maxScore} />
                            {r.score.toFixed(3)}
                          </div>
                        </TD>
                        <TD className="max-w-md truncate text-xs text-[hsl(var(--muted))]" title={r.evidence}>
                          {r.evidence}
                        </TD>
                        <TD>
                          <ActionInSql sql={sqlSnippet} variant="outline" size="sm">
                            Preview JOIN
                          </ActionInSql>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  )
}

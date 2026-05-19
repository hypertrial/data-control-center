import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { ActionInSql } from '@/components/ActionInSql'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { PageContainer } from '@/components/ui/section'
import { TableSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Badge } from '@/components/ui/badge'
import { formatCount } from '@/lib/format'
import { sqlWherePkSample } from '@/lib/sql'
import { useUiStore } from '@/store/uiStore'

const PAGE_OPTIONS = [50, 100, 250, 500] as const

export function SamplesPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_OPTIONS)[number]>(100)
  const [jump, setJump] = useState('')

  const profileHook = useDatasetProfile(activeId)
  const profileQ = {
    data: profileHook.data,
    isLoading: profileHook.isPendingProfile,
    isError: profileHook.isError,
    error: profileHook.error,
  }

  const q = useQuery({
    queryKey: ['sample', activeId, page, pageSize],
    queryFn: () => api.getSample(activeId!, page, pageSize),
    enabled: !!activeId,
  })

  const typeByCol = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of profileQ.data?.column_profiles ?? []) m[c.name] = c.semantic_type
    return m
  }, [profileQ.data])

  const idCol = profileQ.data?.potential_id_columns[0] ?? profileQ.data?.potential_key_columns[0]

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
        <TableSkeleton rows={6} cols={6} />
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

  const res = q.data!
  const cols = res.columns
  const total = res.total_rows
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total > 0 ? (res.page - 1) * res.page_size + 1 : 0
  const end = start + res.row_count - 1

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[hsl(var(--muted))]">
          Rows{' '}
          <span className="tabular-nums text-white/90">
            {start}-{Math.max(start, end)}
          </span>{' '}
          of <span className="tabular-nums text-white/90">{formatCount(total)}</span>
          <span className="mx-2 text-white/15">·</span>
          Page <span className="tabular-nums">{res.page}</span> of{' '}
          <span className="tabular-nums">{totalPages}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-[hsl(var(--muted))]">
            Go to
            <Input
              className="h-8 w-16 px-2 text-xs"
              value={jump}
              placeholder="#"
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const n = Number(jump)
                if (!Number.isFinite(n)) return
                const p = Math.min(totalPages, Math.max(1, Math.floor(n)))
                setPage(p)
                setJump('')
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted))]">
            Page size
            <select
              className="h-9 rounded-md border border-border-default bg-black/30 px-2 text-sm"
              value={pageSize}
              onChange={(e) => {
                setPage(1)
                setPageSize(Number(e.target.value) as (typeof PAGE_OPTIONS)[number])
              }}
            >
              {PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={(page - 1) * pageSize + res.row_count >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-border-default">
        <table className="w-full min-w-max text-left text-sm">
          <caption className="sr-only">Sample rows</caption>
          <THead>
            <TR>
              <TH
                scope="col"
                className="sticky left-0 z-20 min-w-[3rem] bg-[hsl(var(--background))] shadow-[2px_0_8px_rgba(0,0,0,0.4)]"
              >
                #
              </TH>
              {cols.map((c) => (
                <TH key={c} scope="col" className="whitespace-nowrap bg-[hsl(var(--card))]/95 backdrop-blur">
                  <div className="flex flex-col gap-1">
                    <span>{c}</span>
                    {typeByCol[c] && (
                      <Badge variant="default" className="w-fit font-mono text-[10px] font-normal">
                        {typeByCol[c]}
                      </Badge>
                    )}
                  </div>
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {res.rows.map((row, i) => {
              const globalIdx = (page - 1) * pageSize + i + 1
              const pkVal = idCol ? row[idCol] : null
              const whereSql =
                idCol != null && pkVal != null && String(pkVal).length > 0
                  ? sqlWherePkSample(activeId, idCol, pkVal, 50)
                  : null
              return (
                <TR key={i} className="group">
                  <TD className="sticky left-0 z-10 bg-[hsl(var(--background))]/98 text-xs text-[hsl(var(--muted))] shadow-[2px_0_8px_rgba(0,0,0,0.25)]">
                    <div className="flex items-center gap-1.5 font-mono">
                      {globalIdx}
                      {whereSql && (
                        <ActionInSql sql={whereSql} variant="ghost" size="sm" className="h-7 px-1.5 text-[10px]">
                          SQL
                        </ActionInSql>
                      )}
                    </div>
                  </TD>
                  {cols.map((c) => (
                    <TD
                      key={c}
                      className={
                        typeByCol[c] === 'numeric'
                          ? 'max-w-[24ch] truncate font-mono text-xs'
                          : 'max-w-[24ch] truncate text-xs'
                      }
                      title={formatCell(row[c])}
                    >
                      {formatCell(row[c])}
                    </TD>
                  ))}
                </TR>
              )
            })}
          </TBody>
        </table>
      </div>
    </PageContainer>
  )
}

function formatCell(v: unknown) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

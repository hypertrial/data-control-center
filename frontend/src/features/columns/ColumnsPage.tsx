import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingFn,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar,
  CaseSensitive,
  Eye,
  Hash,
  HelpCircle,
  KeyRound,
  Search,
  Tags,
  ToggleLeft,
} from 'lucide-react'
import { api } from '@/api/client'
import type { ColumnProfile, SemanticType } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { PageContainer } from '@/components/ui/section'
import { TableSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { useUiStore } from '@/store/uiStore'
import { ColumnDetailDrawer } from '@/features/columns/ColumnDetailDrawer'
import { formatCount, formatEdaNumericString, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const colHelper = createColumnHelper<ColumnProfile>()

const SEM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'categorical', label: 'Categorical' },
  { value: 'datetime', label: 'Datetime' },
  { value: 'id_like', label: 'ID-like' },
  { value: 'boolean_like', label: 'Boolean' },
  { value: 'text', label: 'Text' },
  { value: 'unknown', label: 'Unknown' },
]

const CQ_OPTIONS: Array<{ value: 'all' | 'has_flags' | 'critical_only'; label: string }> = [
  { value: 'all', label: 'Any' },
  { value: 'has_flags', label: 'Has flags' },
  { value: 'critical_only', label: 'Critical flags' },
]

const COLUMN_TOOLBAR_IDS: Array<{ id: string; label: string }> = [
  { id: 'name', label: 'Column' },
  { id: 'type_col', label: 'Type' },
  { id: 'missing', label: 'Missing' },
  { id: 'unique_pct', label: 'Unique' },
  { id: 'range_col', label: 'Range' },
  { id: 'mean_sort', label: 'Center' },
  { id: 'spread_sort', label: 'Spread' },
  { id: 'top_pct', label: 'Top' },
  { id: 'quality_flags', label: 'Flags' },
  { id: 'cardinality', label: 'Cardinality' },
]

const sortOptionalNumber: SortingFn<ColumnProfile> = (rowA, rowB, columnId) => {
  const a = rowA.getValue(columnId) as number | null | undefined
  const b = rowB.getValue(columnId) as number | null | undefined
  const na = a == null || Number.isNaN(a) ? Number.NEGATIVE_INFINITY : a
  const nb = b == null || Number.isNaN(b) ? Number.NEGATIVE_INFINITY : b
  if (na === nb) return 0
  return na < nb ? -1 : 1
}

function TypeIcon({ sem }: { sem: SemanticType }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted))]'
  const wrap = (label: string, node: ReactNode) => (
    <span title={label} className="inline-flex">
      {node}
    </span>
  )
  switch (sem) {
    case 'numeric':
      return wrap('Numeric', <Hash className={cls} aria-hidden />)
    case 'categorical':
      return wrap('Categorical', <Tags className={cls} aria-hidden />)
    case 'datetime':
      return wrap('Datetime', <Calendar className={cls} aria-hidden />)
    case 'boolean_like':
      return wrap('Boolean-like', <ToggleLeft className={cls} aria-hidden />)
    case 'id_like':
      return wrap('ID-like', <KeyRound className={cls} aria-hidden />)
    case 'text':
      return wrap('Text', <CaseSensitive className={cls} aria-hidden />)
    default:
      return wrap('Unknown', <HelpCircle className={cls} aria-hidden />)
  }
}

function NullBar({ pct }: { pct: number }) {
  const warm = pct > 30 ? 'bg-[hsl(var(--severity-critical))]' : pct > 10 ? 'bg-[hsl(var(--severity-warning))]' : 'bg-[hsl(var(--severity-info))]'
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10" title={`${pct.toFixed(2)}% null`}>
        <div className={cn('h-full rounded-full transition-all', warm)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="tabular-nums text-xs text-[hsl(var(--muted))]">{pct.toFixed(1)}</span>
    </div>
  )
}

const EMPTY_HIDDEN: string[] = []

export function ColumnsPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const columnSearch = useUiStore((s) => s.columnSearch)
  const setColumnSearch = useUiStore((s) => s.setColumnSearch)
  const semanticFilter = useUiStore((s) => s.semanticFilter)
  const setSemanticFilter = useUiStore((s) => s.setSemanticFilter)
  const columnQualityFilter = useUiStore((s) => s.columnQualityFilter)
  const setColumnQualityFilter = useUiStore((s) => s.setColumnQualityFilter)
  const selectedColumn = useUiStore((s) => s.selectedColumn)
  const setSelectedColumn = useUiStore((s) => s.setSelectedColumn)
  const drawerOpen = useUiStore((s) => s.columnDrawerOpen)
  const setDrawerOpen = useUiStore((s) => s.setColumnDrawerOpen)
  const hiddenMap = useUiStore((s) => s.columnsTableHidden)
  const hiddenCols = activeId ? (hiddenMap[activeId] ?? EMPTY_HIDDEN) : EMPTY_HIDDEN
  const toggleColVis = useUiStore((s) => s.toggleColumnTableVisibility)

  const [sorting, setSorting] = useState<SortingState>([{ id: 'missing', desc: true }])

  const q = useQuery({
    queryKey: ['profile', activeId],
    queryFn: () => api.getProfile(activeId!),
    enabled: !!activeId,
  })

  const datasetsQ = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const activeViewName = useMemo(
    () => datasetsQ.data?.find((d) => d.dataset_id === activeId)?.view_name ?? '',
    [datasetsQ.data, activeId],
  )

  const allColumnDefs = useMemo(
    () => [
      colHelper.accessor('name', {
        header: 'Column',
        cell: (ctx) => {
          const name = ctx.getValue()
          return (
            <div className="flex min-w-0 max-w-[min(32rem,70vw)] items-center gap-2">
              <TypeIcon sem={ctx.row.original.semantic_type} />
              <span className="min-w-0 truncate font-mono text-sm" title={name}>
                {name}
              </span>
            </div>
          )
        },
      }),
      colHelper.accessor((r) => `${r.physical_type}|${r.semantic_type}`, {
        id: 'type_col',
        header: 'Type',
        enableSorting: false,
        cell: (ctx) => {
          const r = ctx.row.original
          return (
            <div className="flex min-w-0 max-w-[10rem] flex-col gap-0.5">
              <span className="truncate font-mono text-xs text-fg" title={r.physical_type}>
                {r.physical_type}
              </span>
              <span className="truncate text-[10px] capitalize text-[hsl(var(--muted))]" title={r.semantic_type}>
                {r.semantic_type.replaceAll('_', ' ')}
              </span>
            </div>
          )
        },
      }),
      colHelper.accessor((r) => r.null_count ?? null, {
        id: 'missing',
        header: 'Missing',
        sortingFn: sortOptionalNumber,
        cell: (ctx) => {
          const r = ctx.row.original
          return (
            <div className="flex min-w-[150px] flex-col gap-1">
              <span className="tabular-nums text-xs text-fg">{formatCount(r.null_count)} null</span>
              <NullBar pct={r.null_pct} />
            </div>
          )
        },
      }),
      colHelper.accessor((r) => r.unique_pct ?? null, {
        id: 'unique_pct',
        header: 'Unique',
        sortingFn: sortOptionalNumber,
        cell: (ctx) => {
          const r = ctx.row.original
          return (
            <div className="min-w-[110px] text-xs">
              <span className="tabular-nums text-fg">{formatCount(r.unique_count)}</span>
              <span className="text-[hsl(var(--muted))]"> · </span>
              <span className="tabular-nums text-fg">{formatPercent(r.unique_pct)}</span>
            </div>
          )
        },
      }),
      colHelper.accessor((r) => `${r.min_value ?? ''}→${r.max_value ?? ''}`, {
        id: 'range_col',
        header: 'Range',
        enableSorting: false,
        cell: (ctx) => {
          const r = ctx.row.original
          if (r.min_value == null && r.max_value == null) {
            return <span className="text-[hsl(var(--muted))]">—</span>
          }
          const minShown = r.min_value != null ? formatEdaNumericString(r.min_value) : '—'
          const maxShown = r.max_value != null ? formatEdaNumericString(r.max_value) : '—'
          return (
            <span
              className="block max-w-[14rem] truncate font-mono text-xs text-fg"
              title={`${r.min_value ?? ''} → ${r.max_value ?? ''}`}
            >
              {minShown} → {maxShown}
            </span>
          )
        },
      }),
      colHelper.accessor((r) => {
        if (r.mean_value == null || r.mean_value === '') return null
        const n = Number(r.mean_value)
        return Number.isFinite(n) ? n : null
      }, {
        id: 'mean_sort',
        header: 'Center',
        sortingFn: sortOptionalNumber,
        cell: (ctx) => {
          const r = ctx.row.original
          const mean = r.mean_value
          const med = r.median_value
          if (!mean && !med) return <span className="text-[hsl(var(--muted))]">—</span>
          return (
            <div className="max-w-[12rem] text-xs">
              {mean ? (
                <div className="truncate font-mono text-fg" title={`mean ${mean}`}>
                  μ {formatEdaNumericString(mean)}
                </div>
              ) : null}
              {med ? (
                <div className="truncate font-mono text-[hsl(var(--muted))]" title={`median ${med}`}>
                  med {formatEdaNumericString(med)}
                </div>
              ) : null}
            </div>
          )
        },
      }),
      colHelper.accessor((r) => {
        if (r.std_value == null || r.std_value === '') return null
        const n = Number(r.std_value)
        return Number.isFinite(n) ? n : null
      }, {
        id: 'spread_sort',
        header: 'Spread',
        sortingFn: sortOptionalNumber,
        cell: (ctx) => {
          const r = ctx.row.original
          const std = r.std_value
          const iqr =
            r.p25_value != null && r.p75_value != null
              ? `${formatEdaNumericString(r.p25_value)}–${formatEdaNumericString(r.p75_value)}`
              : null
          const iqrTitle =
            r.p25_value != null && r.p75_value != null ? `${r.p25_value}–${r.p75_value}` : undefined
          if (!std && !iqr) return <span className="text-[hsl(var(--muted))]">—</span>
          return (
            <div className="max-w-[12rem] text-xs">
              {std ? (
                <div className="truncate font-mono text-fg" title={`std ${std}`}>
                  σ {formatEdaNumericString(std)}
                </div>
              ) : null}
              {iqr ? (
                <div className="truncate font-mono text-[hsl(var(--muted))]" title={iqrTitle ? `IQR ${iqrTitle}` : undefined}>
                  IQR {iqr}
                </div>
              ) : null}
            </div>
          )
        },
      }),
      colHelper.accessor((r) => r.top_pct ?? null, {
        id: 'top_pct',
        header: 'Top',
        sortingFn: sortOptionalNumber,
        cell: (ctx) => {
          const r = ctx.row.original
          if (r.top_value == null && r.top_count == null) {
            return <span className="text-[hsl(var(--muted))]">—</span>
          }
          const title = `${r.top_value ?? ''} (${r.top_count}, ${r.top_pct ?? ''}%)`
          return (
            <div className="max-w-[min(14rem,30vw)] min-w-0" title={title}>
              <span className="block truncate font-mono text-xs text-fg">{r.top_value ?? '—'}</span>
              <span className="block truncate tabular-nums text-[10px] text-[hsl(var(--muted))]">
                {formatCount(r.top_count)} · {formatPercent(r.top_pct)}
              </span>
            </div>
          )
        },
      }),
      colHelper.accessor('quality_flags', {
        header: 'Flags',
        sortingFn: (ra, rb, colId) => {
          const a = (ra.getValue(colId) as string[]).length
          const b = (rb.getValue(colId) as string[]).length
          return a === b ? 0 : a < b ? -1 : 1
        },
        cell: (ctx) => {
          const flags = ctx.getValue()
          if (!flags.length) return <span className="text-[hsl(var(--muted))]">—</span>
          return (
            <div
              className="flex max-w-[min(14rem,30vw)] min-w-0 flex-wrap gap-1"
              title={flags.join(', ')}
            >
              {flags.map((f) => (
                <Badge key={f} variant="warning" className="max-w-full truncate font-normal" title={f}>
                  {f}
                </Badge>
              ))}
            </div>
          )
        },
      }),
      colHelper.accessor('cardinality', {
        header: 'Cardinality',
        cell: (ctx) => <span className="tabular-nums">{ctx.getValue() ?? '—'}</span>,
      }),
    ],
    [],
  )

  const columns = useMemo(
    () => allColumnDefs.filter((c) => !hiddenCols.includes(String(c.id))),
    [allColumnDefs, hiddenCols],
  )

  const data = useMemo(() => {
    let rows = q.data?.column_profiles ?? []
    if (columnSearch.trim()) {
      const s = columnSearch.toLowerCase()
      rows = rows.filter((r) => r.name.toLowerCase().includes(s))
    }
    if (semanticFilter !== 'all') {
      rows = rows.filter((r) => r.semantic_type === semanticFilter)
    }
    if (columnQualityFilter === 'has_flags') {
      rows = rows.filter((r) => r.quality_flags.length > 0)
    }
    if (columnQualityFilter === 'critical_only') {
      rows = rows.filter(
        (r) =>
          r.quality_flags.includes('high_missingness') || r.quality_flags.includes('id_with_nulls'),
      )
    }
    return rows
  }, [q.data, columnSearch, semanticFilter, columnQualityFilter])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table useReactTable
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const selected = useMemo(
    () => data.find((c) => c.name === selectedColumn) ?? null,
    [data, selectedColumn],
  )

  const totalCols = q.data?.column_profiles.length ?? 0
  const sampleRows = q.data?.profiler_sample_rows
  const fullRows = q.data?.rows

  const summaryParts = useMemo(() => {
    const bits: string[] = []
    if (columnSearch.trim()) bits.push(`name contains "${columnSearch.trim()}"`)
    if (semanticFilter !== 'all') bits.push(`semantic: ${semanticFilter}`)
    if (columnQualityFilter === 'has_flags') bits.push('quality: has flags')
    if (columnQualityFilter === 'critical_only') bits.push('quality: critical flags')
    return bits
  }, [columnSearch, semanticFilter, columnQualityFilter])

  if (!activeId) {
    return (
      <PageContainer>
        <p className="text-sm text-[hsl(var(--muted))]">Select a dataset.</p>
      </PageContainer>
    )
  }

  if (q.isLoading) {
    return (
      <PageContainer>
        <TableSkeleton rows={8} cols={10} />
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
      <div className="rounded-lg border border-border-default bg-white/[0.02] p-3 sm:p-4">
        <div className="mb-3 text-xs font-semibold tracking-tight text-white">Filter columns</div>
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-4 lg:gap-y-3">
          <div className="min-w-[200px] flex-1 lg:max-w-md">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
              Name contains
            </div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
                aria-hidden
              />
              <Input
                placeholder="Column name…"
                value={columnSearch}
                onChange={(e) => setColumnSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="min-w-0 flex-1 lg:min-w-[320px]">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
              Semantic type
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SEM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSemanticFilter(opt.value)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition',
                    semanticFilter === opt.value
                      ? 'bg-white/12 text-white'
                      : 'text-[hsl(var(--muted))] hover:bg-white/5 hover:text-white',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
                Quality
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CQ_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setColumnQualityFilter(opt.value)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs transition',
                      columnQualityFilter === opt.value
                        ? 'bg-white/12 text-white'
                        : 'text-[hsl(var(--muted))] hover:bg-white/5 hover:text-white',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1">
                  <Eye className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Visible in table</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUMN_TOOLBAR_IDS.map(({ id, label }) => (
                  <DropdownMenuCheckboxItem
                    key={id}
                    checked={!hiddenCols.includes(id)}
                    onCheckedChange={() => toggleColVis(activeId, id)}
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[hsl(var(--muted))]">
        Showing <span className="tabular-nums text-fg">{data.length}</span> of{' '}
        <span className="tabular-nums text-fg">{totalCols}</span> columns
        {summaryParts.length ? ` · ${summaryParts.join(' · ')}` : ''}.{' '}
        {sampleRows != null && fullRows != null && sampleRows < fullRows
          ? `EDA stats use the first ${sampleRows.toLocaleString()} rows (sample; full table has ${fullRows.toLocaleString()} rows). Uniqueness and distributions follow this sample.`
          : sampleRows != null && fullRows != null && sampleRows === fullRows
            ? `EDA stats use all ${fullRows.toLocaleString()} rows in this table.`
            : 'EDA stats follow the profiler sample window for large datasets.'}
      </p>

      <Table className="min-w-[1180px]">
        <caption className="sr-only">Columns for dataset {activeId}</caption>
        <THead className="sticky top-0 z-10 bg-[hsl(var(--background))]/95 backdrop-blur">
          {table.getHeaderGroups().map((hg) => (
            <TR key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted()
                const isName = h.column.id === 'name'
                return (
                  <TH
                    key={h.id}
                    scope="col"
                    className={cn(
                      isName &&
                        'sticky left-0 z-30 w-[min(28rem,40vw)] min-w-[12rem] max-w-[min(28rem,40vw)] border-r border-border-default bg-[hsl(var(--background))]/95 backdrop-blur',
                    )}
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                    }
                  >
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 font-medium"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{
                          asc: '↑',
                          desc: '↓',
                        }[h.column.getIsSorted() as string] ?? null}
                      </button>
                    ) : (
                      <span className="font-medium">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </span>
                    )}
                  </TH>
                )
              })}
            </TR>
          ))}
        </THead>
        <TBody>
          {table.getRowModel().rows.map((row) => (
            <TR
              key={row.id}
              className="group cursor-pointer"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  const name = row.original.name
                  setSelectedColumn(name)
                  setDrawerOpen(true)
                }
              }}
              onClick={() => {
                const name = row.original.name
                setSelectedColumn(name)
                setDrawerOpen(true)
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TD
                  key={cell.id}
                  className={cn(
                    cell.column.id === 'name' &&
                      'sticky left-0 z-20 w-[min(28rem,40vw)] min-w-[12rem] max-w-[min(28rem,40vw)] border-r border-border-default bg-[hsl(var(--background))]/95 backdrop-blur group-hover:bg-white/[0.04]',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>

      <ColumnDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        column={selected}
        viewName={activeViewName}
      />
    </PageContainer>
  )
}

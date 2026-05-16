import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
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
  { id: 'physical_type', label: 'Physical type' },
  { id: 'semantic_type', label: 'Semantic' },
  { id: 'null_pct', label: 'Null %' },
  { id: 'quality_flags', label: 'Flags' },
  { id: 'unique_count', label: 'Unique' },
  { id: 'cardinality', label: 'Cardinality' },
]

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

  const [sorting, setSorting] = useState<SortingState>([{ id: 'null_pct', desc: true }])

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
      colHelper.accessor('physical_type', {
        header: 'Physical type',
        cell: (ctx) => {
          const v = ctx.getValue()
          return (
            <span className="block max-w-[12rem] truncate font-mono text-xs text-fg" title={v}>
              {v}
            </span>
          )
        },
      }),
      colHelper.accessor('semantic_type', {
        header: 'Semantic',
        cell: (ctx) => {
          const v = ctx.getValue()
          return (
            <span className="block max-w-[10rem] truncate text-xs capitalize" title={v}>
              {v}
            </span>
          )
        },
      }),
      colHelper.accessor('null_pct', {
        header: 'Null %',
        cell: (ctx) => <NullBar pct={ctx.getValue()} />,
      }),
      colHelper.accessor('quality_flags', {
        header: 'Flags',
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
      colHelper.accessor('unique_count', {
        header: 'Unique',
        cell: (ctx) => <span className="tabular-nums">{ctx.getValue() ?? '—'}</span>,
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
        <TableSkeleton rows={8} cols={7} />
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

      <Table className="min-w-[760px]">
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
                    {h.isPlaceholder ? null : (
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

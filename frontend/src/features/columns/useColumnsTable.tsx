import { useMemo, useState } from 'react'
import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useDatasetProfile } from '@/hooks/useDatasetProfile'
import { useUiStore } from '@/store/uiStore'
import { formatCount, formatEdaNumericString, formatPercent } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import {
  buildColumnRoleMap,
  metricScopeLabel,
  roleSortKey,
  sortOptionalNumber,
} from '@/features/columns/columnRoleUtils'
import { colHelper } from '@/features/columns/columnsTableConstants'
import { NullBar, TypeIcon } from '@/features/columns/ColumnsTableCells'

const EMPTY_HIDDEN: string[] = []

export function useColumnsTable() {
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

  const profile = useDatasetProfile(activeId)
  const q = {
    data: profile.data,
    isLoading: profile.isPendingProfile,
    isError: profile.isError,
    error: profile.error,
    refetch: profile.refetch,
  }

  const datasetsQ = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const activeViewName = useMemo(
    () => datasetsQ.data?.find((d) => d.dataset_id === activeId)?.view_name ?? '',
    [datasetsQ.data, activeId],
  )

  const columnRoleMap = useMemo(() => buildColumnRoleMap(q.data), [q.data])

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
      colHelper.accessor((r) => roleSortKey(columnRoleMap.get(r.name) ?? []), {
        id: 'role_col',
        header: 'Role',
        sortingFn: sortOptionalNumber,
        cell: (ctx) => {
          const roles = columnRoleMap.get(ctx.row.original.name) ?? []
          if (!roles.length) return <span className="text-[hsl(var(--muted))]">—</span>
          return (
            <div
              className="flex max-w-[min(14rem,28vw)] min-w-0 flex-wrap gap-1"
              title={roles.join(', ')}
            >
              {roles.map((role) => (
                <Badge key={role} variant="info" className="max-w-full truncate px-1.5 py-0 text-[10px] font-normal" title={role}>
                  {role}
                </Badge>
              ))}
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
          const scope = metricScopeLabel(r.metric_scope)
          return (
            <div className="min-w-[110px] text-xs" title={`Uniqueness is based on the ${scope}.`}>
              <span className="tabular-nums text-fg">{formatCount(r.unique_count)}</span>
              <span className="text-[hsl(var(--muted))]"> · </span>
              <span className="tabular-nums text-fg">{formatPercent(r.unique_pct)}</span>
              {r.metric_scope === 'sample' ? (
                <span className="ml-1 text-[10px] text-[hsl(var(--muted))]">sample</span>
              ) : null}
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
          const scope = metricScopeLabel(r.metric_scope)
          const title = `${r.top_value ?? ''} (${r.top_count}, ${r.top_pct ?? ''}%; ${scope})`
          return (
            <div className="max-w-[min(14rem,30vw)] min-w-0" title={title}>
              <span className="block truncate font-mono text-xs text-fg">{r.top_value ?? '—'}</span>
              <span className="block truncate tabular-nums text-[10px] text-[hsl(var(--muted))]">
                {formatCount(r.top_count)} · {formatPercent(r.top_pct)}
                {r.metric_scope === 'sample' ? ' · sample' : ''}
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
    ],
    [columnRoleMap],
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

  return {
    activeId,
    columnSearch,
    setColumnSearch,
    semanticFilter,
    setSemanticFilter,
    columnQualityFilter,
    setColumnQualityFilter,
    setSelectedColumn,
    setDrawerOpen,
    hiddenCols,
    toggleColVis,
    q,
    activeViewName,
    table,
    selected,
    drawerOpen,
    totalCols,
    sampleRows,
    fullRows,
    summaryParts,
    data,
  }
}

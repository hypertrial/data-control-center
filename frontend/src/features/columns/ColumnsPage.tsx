import { useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ColumnProfile } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useUiStore } from '@/store/uiStore'
import { ColumnDetailDrawer } from '@/features/columns/ColumnDetailDrawer'

const colHelper = createColumnHelper<ColumnProfile>()

export function ColumnsPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const columnSearch = useUiStore((s) => s.columnSearch)
  const setColumnSearch = useUiStore((s) => s.setColumnSearch)
  const semanticFilter = useUiStore((s) => s.semanticFilter)
  const setSemanticFilter = useUiStore((s) => s.setSemanticFilter)
  const selectedColumn = useUiStore((s) => s.selectedColumn)
  const setSelectedColumn = useUiStore((s) => s.setSelectedColumn)
  const drawerOpen = useUiStore((s) => s.columnDrawerOpen)
  const setDrawerOpen = useUiStore((s) => s.setColumnDrawerOpen)

  const q = useQuery({
    queryKey: ['profile', activeId],
    queryFn: () => api.getProfile(activeId!),
    enabled: !!activeId,
  })

  const columns = useMemo(
    () => [
      colHelper.accessor('name', { header: 'Column' }),
      colHelper.accessor('physical_type', { header: 'Physical type' }),
      colHelper.accessor('semantic_type', { header: 'Semantic' }),
      colHelper.accessor('null_pct', {
        header: 'Null %',
        cell: (ctx) => ctx.getValue().toFixed(2),
      }),
      colHelper.accessor('unique_count', {
        header: 'Unique',
        cell: (ctx) => ctx.getValue() ?? '—',
      }),
      colHelper.accessor('cardinality', {
        header: 'Cardinality',
        cell: (ctx) => ctx.getValue() ?? '—',
      }),
    ],
    [],
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
    return rows
  }, [q.data, columnSearch, semanticFilter])

  // TanStack Table: hook returns non-memoizable refs; safe for this table surface.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table useReactTable
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const selected = useMemo(
    () => data.find((c) => c.name === selectedColumn) ?? null,
    [data, selectedColumn],
  )

  if (!activeId)
    return <div className="p-6 text-[hsl(var(--muted))]">Select a dataset.</div>
  if (q.isLoading) return <div className="p-6">Loading columns…</div>
  if (q.isError) return <div className="p-6 text-red-300">{(q.error as Error).message}</div>

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <div className="mb-1 text-xs text-[hsl(var(--muted))]">Search columns</div>
          <Input value={columnSearch} onChange={(e) => setColumnSearch(e.target.value)} />
        </div>
        <div>
          <div className="mb-1 text-xs text-[hsl(var(--muted))]">Semantic type</div>
          <select
            className="h-9 rounded-md border border-white/15 bg-black/30 px-2 text-sm"
            value={semanticFilter}
            onChange={(e) => setSemanticFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="numeric">numeric</option>
            <option value="categorical">categorical</option>
            <option value="datetime">datetime</option>
            <option value="id_like">id_like</option>
            <option value="boolean_like">boolean_like</option>
            <option value="text">text</option>
            <option value="unknown">unknown</option>
          </select>
        </div>
      </div>

      <Table>
        <THead>
          {table.getHeaderGroups().map((hg) => (
            <TR key={hg.id}>
              {hg.headers.map((h) => (
                <TH key={h.id}>
                  {h.isPlaceholder ? null : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium"
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
              ))}
            </TR>
          ))}
        </THead>
        <TBody>
          {table.getRowModel().rows.map((row) => (
            <TR
              key={row.id}
              className="cursor-pointer"
              onClick={() => {
                const name = row.original.name
                setSelectedColumn(name)
                setDrawerOpen(true)
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>

      <ColumnDetailDrawer open={drawerOpen} onOpenChange={setDrawerOpen} column={selected} />
    </div>
  )
}

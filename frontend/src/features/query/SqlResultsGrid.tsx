import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Row,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { QueryResult, QueryResultColumn } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  formatCellDetail,
  formatCellDisplay,
  isInSelection,
  isNullishCell,
  isNumericSqlType,
  normalizeSelection,
  queryResultToCsv,
  queryResultToTsv,
  type CellCoord,
} from '@/features/query/queryGridUtils'

const ROW_H = 32
const COL_ROWNUM = '__rownum__'

const colHelper = createColumnHelper<Record<string, unknown>>()

export type SqlResultsGridProps = {
  queryResult: QueryResult
  busy?: boolean
}

export function SqlResultsGrid({ queryResult, busy }: SqlResultsGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({})
  const [anchor, setAnchor] = useState<CellCoord | null>(null)
  const [focus, setFocus] = useState<CellCoord | null>(null)
  const anchorRef = useRef<CellCoord | null>(null)
  const focusRef = useRef<CellCoord | null>(null)
  const dragRef = useRef(false)
  const [cellDetail, setCellDetail] = useState<{ title: string; body: string } | null>(null)

  useEffect(() => {
    anchorRef.current = anchor
  }, [anchor])
  useEffect(() => {
    focusRef.current = focus
  }, [focus])

  const dataRows = queryResult.rows

  useEffect(() => {
    setAnchor(null)
    setFocus(null)
  }, [dataRows])
  const colCount = 1 + queryResult.columns.length

  const columns = useMemo(() => {
    const rowCol = colHelper.display({
      id: COL_ROWNUM,
      header: '#',
      size: 52,
      minSize: 44,
      maxSize: 80,
      enableSorting: false,
      enableResizing: false,
      cell: (ctx) => (
        <span className="tabular-nums text-[hsl(var(--muted))]">{ctx.row.index + 1}</span>
      ),
    })

    const dataCols = queryResult.columns.map((col: QueryResultColumn) =>
      colHelper.accessor((row) => row[col.name], {
        id: col.name,
        header: () => (
          <div className="flex flex-col gap-0.5 pr-2 text-left">
            <span className="truncate font-medium">{col.name}</span>
            {col.type ? (
              <span className="truncate text-[10px] font-normal text-[hsl(var(--muted))]">{col.type}</span>
            ) : null}
          </div>
        ),
        size: 180,
        minSize: 72,
        maxSize: 560,
        sortingFn: (rowA, rowB, columnId) => {
          const a = rowA.getValue(columnId) as unknown
          const b = rowB.getValue(columnId) as unknown
          if (a === b) return 0
          if (a === null || a === undefined) return 1
          if (b === null || b === undefined) return -1
          if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1
          return String(a).localeCompare(String(b), undefined, { numeric: true })
        },
        cell: (ctx) => {
          const v = ctx.getValue() as unknown
          const num = isNumericSqlType(col.type)
          const disp = formatCellDisplay(v)
          const nullish = isNullishCell(v)
          return (
            <span
              className={cn(
                'block max-w-full truncate',
                num ? 'font-mono' : 'font-mono text-xs',
                nullish && 'text-[hsl(var(--muted))]',
              )}
              title={disp}
            >
              {nullish ? 'NULL' : disp}
            </span>
          )
        },
      }),
    )

    return [rowCol, ...dataCols]
  }, [queryResult.columns])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table useReactTable
  const table = useReactTable({
    data: dataRows,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const tableRows = table.getRowModel().rows

  /** Large results use row virtualization; small results render fully (also fixes tests with no layout). */
  const shouldVirtualize = tableRows.length > 200

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })
  const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : []
  const paddingTop = shouldVirtualize && virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom =
    shouldVirtualize && virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0

  const selectionRect = useMemo(() => {
    if (!anchor || !focus) return null
    return normalizeSelection(anchor, focus)
  }, [anchor, focus])

  const sortedDataForExport = useMemo(
    () => tableRows.map((r) => r.original as Record<string, unknown>),
    [tableRows],
  )

  const getValueAt = useCallback(
    (rowIndex: number, colIndex: number): unknown => {
      const row = sortedDataForExport[rowIndex]
      if (!row) return undefined
      if (colIndex === 0) return rowIndex + 1
      const name = queryResult.columns[colIndex - 1]?.name
      return name ? row[name] : undefined
    },
    [sortedDataForExport, queryResult.columns],
  )

  const setSel = useCallback((c: CellCoord, extend: boolean) => {
    if (extend && anchorRef.current) {
      setFocus(c)
      focusRef.current = c
    } else {
      setAnchor(c)
      setFocus(c)
      anchorRef.current = c
      focusRef.current = c
    }
  }, [])

  const onCellMouseDown = useCallback(
    (e: MouseEvent, rowIndex: number, colIndex: number) => {
      dragRef.current = true
      scrollRef.current?.focus()
      setSel({ row: rowIndex, col: colIndex }, e.shiftKey)
    },
    [setSel],
  )

  const onCellMouseEnter = useCallback((rowIndex: number, colIndex: number) => {
    if (dragRef.current && anchorRef.current) {
      const c = { row: rowIndex, col: colIndex }
      setFocus(c)
      focusRef.current = c
    }
  }, [])

  useEffect(() => {
    const up = () => {
      dragRef.current = false
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const moveFocus = useCallback(
    (dr: number, dc: number, extend: boolean) => {
      if (tableRows.length === 0) return
      const cur = focusRef.current ?? anchorRef.current ?? { row: 0, col: 1 }
      const nr = Math.max(0, Math.min(tableRows.length - 1, cur.row + dr))
      const nc = Math.max(0, Math.min(colCount - 1, cur.col + dc))
      if (!extend) {
        const next = { row: nr, col: nc }
        anchorRef.current = next
        focusRef.current = next
        setAnchor(next)
        setFocus(next)
        return
      }
      if (!anchorRef.current) {
        anchorRef.current = cur
        setAnchor(cur)
      }
      const foc = { row: nr, col: nc }
      focusRef.current = foc
      setFocus(foc)
    },
    [colCount, tableRows.length],
  )

  const copySelectionTsv = useCallback(() => {
    if (selectionRect) {
      const tsv = queryResultToTsv(queryResult.columns, sortedDataForExport, selectionRect)
      void navigator.clipboard.writeText(tsv)
      toast.success('Selection copied (TSV)')
      return
    }
    const tsv = queryResultToTsv(queryResult.columns, sortedDataForExport)
    void navigator.clipboard.writeText(tsv)
    toast.success('All rows copied (TSV)')
  }, [queryResult.columns, sortedDataForExport, selectionRect])

  const onGridKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault()
        copySelectionTsv()
        return
      }
      if (tableRows.length === 0) return
      const extend = e.shiftKey
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          moveFocus(1, 0, extend)
          break
        case 'ArrowUp':
          e.preventDefault()
          moveFocus(-1, 0, extend)
          break
        case 'ArrowRight':
          e.preventDefault()
          moveFocus(0, 1, extend)
          break
        case 'ArrowLeft':
          e.preventDefault()
          moveFocus(0, -1, extend)
          break
        default:
          break
      }
    },
    [copySelectionTsv, moveFocus, tableRows.length],
  )

  const openCellDetail = useCallback(
    (rowIndex: number, colIndex: number) => {
      if (colIndex === 0) return
      const name = queryResult.columns[colIndex - 1]?.name
      if (!name) return
      const v = getValueAt(rowIndex, colIndex)
      setCellDetail({ title: name, body: formatCellDetail(v) })
    },
    [getValueAt, queryResult.columns],
  )

  const gridColSpan = table.getAllLeafColumns().length || 1

  return (
    <section className="space-y-2" data-testid="sql-results-grid" aria-label="Query result grid">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-default pb-2">
        <div className="text-xs text-[hsl(var(--muted))]">
          {busy ? (
            <span>Running…</span>
          ) : (
            <>
              <span className="tabular-nums text-white/90">{queryResult.row_count}</span> rows
              {queryResult.truncated ? (
                <span className="text-[hsl(var(--severity-warning))]"> (truncated)</span>
              ) : null}
            </>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={copySelectionTsv}
          disabled={busy}
        >
          <Copy className="h-3.5 w-3.5" /> Copy TSV
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(sortedDataForExport, null, 2))
            toast.success('Result rows copied as JSON')
          }}
          disabled={busy}
        >
          <Copy className="h-3.5 w-3.5" /> Copy JSON
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => {
            void navigator.clipboard.writeText(queryResultToCsv(queryResult.columns, sortedDataForExport))
            toast.success('CSV copied to clipboard')
          }}
          disabled={busy}
        >
          Export CSV
        </Button>
        <span className="text-[10px] text-[hsl(var(--muted))]">
          Click header to sort · Drag cells to select · <kbd className="rounded border border-border-default px-0.5 font-mono">⌘</kbd>
          <kbd className="rounded border border-border-default px-0.5 font-mono">C</kbd> copy TSV
        </span>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        className="max-h-[min(60vh,28rem)] overflow-auto rounded-lg border border-border-default outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Query result</caption>
          <thead className="sticky top-0 z-20 bg-[hsl(var(--card))]/98 shadow-[0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const isRowNum = header.column.id === COL_ROWNUM
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'relative border-b border-white/10 px-2 py-2 text-xs font-medium text-[hsl(var(--muted))]',
                        isRowNum &&
                          'sticky left-0 z-30 min-w-[3rem] bg-[hsl(var(--card))]/98 shadow-[2px_0_8px_rgba(0,0,0,0.35)]',
                        !isRowNum && 'min-w-[6rem]',
                      )}
                      style={{
                        width: header.getSize(),
                        maxWidth: header.getSize(),
                      }}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="flex w-full cursor-pointer select-none items-center gap-1 text-left hover:text-white/90"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? ' ↑' : sorted === 'desc' ? ' ↓' : null}
                        </button>
                      ) : (
                        <div className="flex w-full items-center gap-1 text-left">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </div>
                      )}
                      {header.column.getCanResize() ? (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            header.getResizeHandler()(e)
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation()
                            header.getResizeHandler()(e)
                          }}
                          className={cn(
                            'absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize select-none touch-none',
                            header.column.getIsResizing() && 'bg-white/30',
                          )}
                        />
                      ) : null}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {shouldVirtualize && paddingTop > 0 ? (
              <tr>
                <td colSpan={gridColSpan} style={{ height: paddingTop }} />
              </tr>
            ) : null}
            {shouldVirtualize
              ? virtualRows.map((vr) => {
                  const row = tableRows[vr.index] as Row<Record<string, unknown>>
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-white/5 hover:bg-white/[0.04]"
                      style={{ height: ROW_H }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const colIndex = cell.column.getIndex()
                        const selected =
                          selectionRect != null && isInSelection(row.index, colIndex, selectionRect)
                        const isRowNumCell = cell.column.id === COL_ROWNUM
                        return (
                          <td
                            key={cell.id}
                            data-row={row.index}
                            data-col={colIndex}
                            className={cn(
                              'border-r border-white/5 px-2 py-1 align-middle',
                              isRowNumCell &&
                                'sticky left-0 z-10 bg-[hsl(var(--background))]/98 text-xs shadow-[2px_0_8px_rgba(0,0,0,0.2)]',
                              selected && 'bg-[hsl(var(--accent))]/25 ring-1 ring-inset ring-white/20',
                            )}
                            style={{
                              width: cell.column.getSize(),
                              maxWidth: cell.column.getSize(),
                            }}
                            onMouseDown={(e) => onCellMouseDown(e, row.index, colIndex)}
                            onMouseEnter={() => onCellMouseEnter(row.index, colIndex)}
                            onDoubleClick={() => openCellDetail(row.index, colIndex)}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              : tableRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 hover:bg-white/[0.04]"
                    style={{ height: ROW_H }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const colIndex = cell.column.getIndex()
                      const selected =
                        selectionRect != null && isInSelection(row.index, colIndex, selectionRect)
                      const isRowNumCell = cell.column.id === COL_ROWNUM
                      return (
                        <td
                          key={cell.id}
                          data-row={row.index}
                          data-col={colIndex}
                          className={cn(
                            'border-r border-white/5 px-2 py-1 align-middle',
                            isRowNumCell &&
                              'sticky left-0 z-10 bg-[hsl(var(--background))]/98 text-xs shadow-[2px_0_8px_rgba(0,0,0,0.2)]',
                            selected && 'bg-[hsl(var(--accent))]/25 ring-1 ring-inset ring-white/20',
                          )}
                          style={{
                            width: cell.column.getSize(),
                            maxWidth: cell.column.getSize(),
                          }}
                          onMouseDown={(e) => onCellMouseDown(e, row.index, colIndex)}
                          onMouseEnter={() => onCellMouseEnter(row.index, colIndex)}
                          onDoubleClick={() => openCellDetail(row.index, colIndex)}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                ))}
            {shouldVirtualize && paddingBottom > 0 ? (
              <tr>
                <td colSpan={gridColSpan} style={{ height: paddingBottom }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={!!cellDetail} onOpenChange={(o) => !o && setCellDetail(null)}>
        <DialogContent title={cellDetail?.title} className="max-h-[80vh] max-w-lg overflow-auto">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-white/90">{cellDetail?.body}</pre>
        </DialogContent>
      </Dialog>
    </section>
  )
}

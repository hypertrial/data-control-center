import { createElement, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import type { QueryResult, QueryResultColumn } from '@/api/types'
import { cn } from '@/lib/utils'
import {
  formatCellDetail,
  formatCellDisplay,
  isNullishCell,
  isNumericSqlType,
  normalizeSelection,
  queryResultToTsv,
  type CellCoord,
} from '@/features/query/queryGridUtils'

export const ROW_H = 32
export const COL_ROWNUM = '__rownum__'
const LARGE_EXPORT_CELLS = 200_000

const colHelper = createColumnHelper<Record<string, unknown>>()

function buildColumns(queryColumns: QueryResultColumn[]) {
  const rowCol = colHelper.display({
    id: COL_ROWNUM,
    header: '#',
    size: 52,
    minSize: 44,
    maxSize: 80,
    enableSorting: false,
    enableResizing: false,
    cell: (ctx) => createElement('span', { className: 'tabular-nums text-[hsl(var(--muted))]' }, ctx.row.index + 1),
  })

  const dataCols = queryColumns.map((col: QueryResultColumn) =>
    colHelper.accessor((row) => row[col.name], {
      id: col.name,
      header: () =>
        createElement(
          'div',
          { className: 'flex flex-col gap-0.5 pr-2 text-left' },
          createElement('span', { className: 'truncate font-medium' }, col.name),
          col.type
            ? createElement('span', { className: 'truncate text-[10px] font-normal text-[hsl(var(--muted))]' }, col.type)
            : null,
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
        return createElement(
          'span',
          {
            className: cn('block max-w-full truncate', num ? 'font-mono' : 'font-mono text-xs', nullish && 'text-[hsl(var(--muted))]'),
            title: disp,
          },
          nullish ? 'NULL' : disp,
        )
      },
    }),
  )

  return [rowCol, ...dataCols]
}

export type CellDetail = { title: string; body: string }

export function useSqlResultsGrid(queryResult: QueryResult) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({})
  const [anchor, setAnchor] = useState<CellCoord | null>(null)
  const [focus, setFocus] = useState<CellCoord | null>(null)
  const anchorRef = useRef<CellCoord | null>(null)
  const focusRef = useRef<CellCoord | null>(null)
  const dragRef = useRef(false)
  const [cellDetail, setCellDetail] = useState<CellDetail | null>(null)

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

  const columns = useMemo(() => buildColumns(queryResult.columns), [queryResult.columns])

  // eslint-disable-next-line react-hooks/incompatible-library
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
    shouldVirtualize && virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0

  const selectionRect = useMemo(() => (anchor && focus ? normalizeSelection(anchor, focus) : null), [anchor, focus])

  const sortedDataForExport = useMemo(() => tableRows.map((r) => r.original as Record<string, unknown>), [tableRows])

  const tooLargeForQuickExport = useMemo(() => {
    const cells = sortedDataForExport.length * Math.max(1, queryResult.columns.length)
    return cells >= LARGE_EXPORT_CELLS
  }, [sortedDataForExport.length, queryResult.columns.length])

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

  return {
    scrollRef,
    table,
    tableRows,
    shouldVirtualize,
    virtualRows,
    paddingTop,
    paddingBottom,
    gridColSpan,
    selectionRect,
    sortedDataForExport,
    tooLargeForQuickExport,
    cellDetail,
    setCellDetail,
    copySelectionTsv,
    onGridKeyDown,
    onCellMouseDown,
    onCellMouseEnter,
    openCellDetail,
  }
}

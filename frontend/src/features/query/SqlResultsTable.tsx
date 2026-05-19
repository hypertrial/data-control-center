import { flexRender, type Row, type Table } from '@tanstack/react-table'
import type { VirtualItem } from '@tanstack/react-virtual'
import { type KeyboardEvent, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { isInSelection } from '@/features/query/queryGridUtils'
import { COL_ROWNUM, ROW_H } from '@/features/query/useSqlResultsGrid'

export type SqlResultsTableProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>
  table: Table<Record<string, unknown>>
  tableRows: Row<Record<string, unknown>>[]
  shouldVirtualize: boolean
  virtualRows: VirtualItem[]
  paddingTop: number
  paddingBottom: number
  gridColSpan: number
  selectionRect: { r0: number; r1: number; c0: number; c1: number } | null
  onGridKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  onCellMouseDown: (e: MouseEvent, rowIndex: number, colIndex: number) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  openCellDetail: (rowIndex: number, colIndex: number) => void
}

export function SqlResultsTable({
  scrollRef,
  table,
  tableRows,
  shouldVirtualize,
  virtualRows,
  paddingTop,
  paddingBottom,
  gridColSpan,
  selectionRect,
  onGridKeyDown,
  onCellMouseDown,
  onCellMouseEnter,
  openCellDetail,
}: SqlResultsTableProps) {
  const rowsToRender = shouldVirtualize
    ? virtualRows.map((vr) => tableRows[vr.index] as Row<Record<string, unknown>>)
    : tableRows

  return (
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
                      isRowNum && 'sticky left-0 z-30 min-w-[3rem] bg-[hsl(var(--card))]/98 shadow-[2px_0_8px_rgba(0,0,0,0.35)]',
                      !isRowNum && 'min-w-[6rem]',
                    )}
                    style={{ width: header.getSize(), maxWidth: header.getSize() }}
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
          {rowsToRender.map((row) => (
            <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.04]" style={{ height: ROW_H }}>
              {row.getVisibleCells().map((cell) => {
                const colIndex = cell.column.getIndex()
                const selected = selectionRect != null && isInSelection(row.index, colIndex, selectionRect)
                const isRowNumCell = cell.column.id === COL_ROWNUM
                return (
                  <td
                    key={cell.id}
                    data-row={row.index}
                    data-col={colIndex}
                    className={cn(
                      'border-r border-white/5 px-2 py-1 align-middle',
                      isRowNumCell && 'sticky left-0 z-10 bg-[hsl(var(--background))]/98 text-xs shadow-[2px_0_8px_rgba(0,0,0,0.2)]',
                      selected && 'bg-[hsl(var(--accent))]/25 ring-1 ring-inset ring-white/20',
                    )}
                    style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }}
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
  )
}

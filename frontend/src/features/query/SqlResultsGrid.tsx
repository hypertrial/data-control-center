import type { QueryResult } from '@/api/types'
import { CellDetailDialog } from '@/features/query/CellDetailDialog'
import { SqlResultsTable } from '@/features/query/SqlResultsTable'
import { SqlResultsToolbar } from '@/features/query/SqlResultsToolbar'
import { useSqlResultsGrid } from '@/features/query/useSqlResultsGrid'

export type SqlResultsGridProps = {
  queryResult: QueryResult
  busy?: boolean
}

export function SqlResultsGrid({ queryResult, busy }: SqlResultsGridProps) {
  const grid = useSqlResultsGrid(queryResult)

  return (
    <section className="space-y-2" data-testid="sql-results-grid" aria-label="Query result grid">
      <SqlResultsToolbar
        queryResult={queryResult}
        busy={busy}
        tooLargeForQuickExport={grid.tooLargeForQuickExport}
        sortedDataForExport={grid.sortedDataForExport}
        copySelectionTsv={grid.copySelectionTsv}
      />
      <SqlResultsTable
        scrollRef={grid.scrollRef}
        table={grid.table}
        tableRows={grid.tableRows}
        shouldVirtualize={grid.shouldVirtualize}
        virtualRows={grid.virtualRows}
        paddingTop={grid.paddingTop}
        paddingBottom={grid.paddingBottom}
        gridColSpan={grid.gridColSpan}
        selectionRect={grid.selectionRect}
        onGridKeyDown={grid.onGridKeyDown}
        onCellMouseDown={grid.onCellMouseDown}
        onCellMouseEnter={grid.onCellMouseEnter}
        openCellDetail={grid.openCellDetail}
      />
      <CellDetailDialog cellDetail={grid.cellDetail} onClose={() => grid.setCellDetail(null)} />
    </section>
  )
}

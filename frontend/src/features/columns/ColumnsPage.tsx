import { PageContainer } from '@/components/ui/section'
import { TableSkeleton } from '@/components/ui/skeleton'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { ColumnDetailDrawer } from '@/features/columns/ColumnDetailDrawer'
import { ColumnsFilters } from '@/features/columns/ColumnsFilters'
import { ColumnsTable } from '@/features/columns/ColumnsTable'
import { useColumnsTable } from '@/features/columns/useColumnsTable'

export function ColumnsPage() {
  const {
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
  } = useColumnsTable()

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
      <ColumnsFilters
        activeId={activeId}
        columnSearch={columnSearch}
        setColumnSearch={setColumnSearch}
        semanticFilter={semanticFilter}
        setSemanticFilter={setSemanticFilter}
        columnQualityFilter={columnQualityFilter}
        setColumnQualityFilter={setColumnQualityFilter}
        hiddenCols={hiddenCols}
        toggleColVis={toggleColVis}
      />

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

      <ColumnsTable
        activeId={activeId}
        table={table}
        setSelectedColumn={setSelectedColumn}
        setDrawerOpen={setDrawerOpen}
      />

      <ColumnDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        column={selected}
        viewName={activeViewName}
      />
    </PageContainer>
  )
}

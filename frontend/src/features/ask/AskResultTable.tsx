import type { QueryResult } from '@/api/types'
import { SqlResultsGrid } from '@/features/query/SqlResultsGrid'

export function AskResultTable({ queryResult }: { queryResult: QueryResult }) {
  if (queryResult.error || queryResult.columns.length === 0) return null

  return (
    <div data-testid="ask-result-table">
      <SqlResultsGrid queryResult={queryResult} />
    </div>
  )
}

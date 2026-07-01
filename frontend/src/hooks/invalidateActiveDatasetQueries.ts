import type { QueryClient } from '@tanstack/react-query'

/** Mark per-dataset TanStack Query caches stale so re-selection refetches current data. */
export function invalidateActiveDatasetQueries(qc: QueryClient, datasetId: string): void {
  void qc.invalidateQueries({ queryKey: ['profile', datasetId] })
  void qc.invalidateQueries({ queryKey: ['quality', datasetId] })
  void qc.invalidateQueries({ queryKey: ['profile-history', datasetId] })
  void qc.invalidateQueries({ queryKey: ['profile-diff', datasetId] })
  void qc.invalidateQueries({ queryKey: ['sample', datasetId] })
}

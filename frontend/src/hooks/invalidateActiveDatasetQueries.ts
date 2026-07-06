import type { QueryClient } from '@tanstack/react-query'

export const ACTIVE_DATASET_QUERY_KEYS = [
  'profile',
  'quality',
  'profile-history',
  'profile-diff',
  'sample',
] as const

type CacheOptions = {
  includeDatasets?: boolean
}

/** Mark per-dataset TanStack Query caches stale so re-selection refetches current data. */
export function invalidateActiveDatasetQueries(
  qc: QueryClient,
  datasetId: string,
  options: CacheOptions = {},
): void {
  for (const key of ACTIVE_DATASET_QUERY_KEYS) {
    void qc.invalidateQueries({ queryKey: [key, datasetId] })
  }
  if (options.includeDatasets) {
    void qc.invalidateQueries({ queryKey: ['datasets'] })
  }
}

/** Remove per-dataset TanStack Query caches after the dataset is deleted. */
export function removeActiveDatasetQueries(qc: QueryClient, datasetId: string): void {
  for (const key of ACTIVE_DATASET_QUERY_KEYS) {
    qc.removeQueries({ queryKey: [key, datasetId] })
  }
}

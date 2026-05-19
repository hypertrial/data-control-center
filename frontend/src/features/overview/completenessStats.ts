import type { ColumnProfile, DatasetProfile } from '@/api/types'

export type CompletenessSeverity = 'ok' | 'warning' | 'critical'

export type CompletenessStats = {
  populatedPct: number | null
  missingPct: number | null
  estimatedMissingCells: number | null
  estimatedDuplicateRows: number | null
  colsWithNulls: number
  colsHighNull: number
  colsFullyNull: number
  isSampleProfile: boolean
  sampleLabel: string | null
  missingSeverity: CompletenessSeverity
}

const HIGH_NULL_THRESHOLD = 20

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function missingSeverityFromPct(missingPct: number | null): CompletenessSeverity {
  if (missingPct == null) return 'ok'
  if (missingPct > 50) return 'critical'
  if (missingPct > 20) return 'warning'
  return 'ok'
}

export function computeCompletenessStats(profile: DatasetProfile): CompletenessStats {
  const cols = profile.column_profiles ?? []
  const missingPct =
    profile.missing_cell_pct != null ? clampPct(profile.missing_cell_pct) : null
  const populatedPct = missingPct != null ? clampPct(100 - missingPct) : null

  const rows = profile.rows
  const columnCount = profile.columns
  const estimatedMissingCells =
    missingPct != null && rows != null && columnCount != null
      ? Math.round((rows * columnCount * missingPct) / 100)
      : null

  const dupPct = profile.duplicate_row_pct
  const estimatedDuplicateRows =
    dupPct != null && rows != null ? Math.round((rows * dupPct) / 100) : null

  const colsWithNulls = cols.filter((c) => c.null_pct > 0).length
  const colsHighNull = cols.filter((c) => c.null_pct >= HIGH_NULL_THRESHOLD).length
  const colsFullyNull = cols.filter((c) => c.null_pct >= 100).length

  const sampleRows = profile.profiler_sample_rows
  const isSampleProfile =
    sampleRows != null && rows != null && sampleRows < rows
  const sampleLabel = isSampleProfile
    ? `Based on ${sampleRows.toLocaleString()}-row sample`
    : null

  return {
    populatedPct,
    missingPct,
    estimatedMissingCells,
    estimatedDuplicateRows,
    colsWithNulls,
    colsHighNull,
    colsFullyNull,
    isSampleProfile,
    sampleLabel,
    missingSeverity: missingSeverityFromPct(missingPct),
  }
}

export function rankColumnsByNullPct(
  columnProfiles: ColumnProfile[],
  limit: number,
): { names: string[]; values: number[] } {
  const sorted = [...columnProfiles].sort((a, b) => b.null_pct - a.null_pct).slice(0, limit)
  return {
    names: sorted.map((c) => c.name),
    values: sorted.map((c) => c.null_pct),
  }
}

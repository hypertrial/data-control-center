import type { SortingFn } from '@tanstack/react-table'
import type { ColumnProfile, DatasetProfile } from '@/api/types'

export const COLUMN_ROLE_LABELS = ['grain key', 'entity id', 'time', 'measure'] as const
export type ColumnRoleLabel = (typeof COLUMN_ROLE_LABELS)[number]

export function roleSortKey(roles: ColumnRoleLabel[]): number {
  if (!roles.length) return 0
  const minPri = Math.min(...roles.map((r) => COLUMN_ROLE_LABELS.indexOf(r)))
  return roles.length * 100 + (COLUMN_ROLE_LABELS.length - minPri)
}

export function buildColumnRoleMap(profile: DatasetProfile | undefined): Map<string, ColumnRoleLabel[]> {
  const out = new Map<string, ColumnRoleLabel[]>()
  if (!profile) return out

  const grainCols =
    profile.primary_grain_key_columns.length > 0
      ? profile.primary_grain_key_columns
      : profile.potential_key_columns

  const entityCols =
    profile.entity_id_columns.length > 0
      ? profile.entity_id_columns.map((e) => e.name)
      : profile.potential_id_columns

  const measureCols =
    profile.measure_candidates.length > 0
      ? profile.measure_candidates.map((m) => m.name)
      : profile.main_numeric_measures

  const timeNames = new Set<string>()
  if (profile.primary_temporal_column?.name) timeNames.add(profile.primary_temporal_column.name)
  if (profile.primary_date_column) timeNames.add(profile.primary_date_column)
  for (const t of profile.temporal_columns) timeNames.add(t.name)

  const addRole = (col: string, role: ColumnRoleLabel) => {
    const cur = out.get(col) ?? []
    if (!cur.includes(role)) cur.push(role)
    out.set(col, cur)
  }

  const orderRank = (roles: ColumnRoleLabel[]) =>
    [...roles].sort((a, b) => COLUMN_ROLE_LABELS.indexOf(a) - COLUMN_ROLE_LABELS.indexOf(b))

  for (const c of grainCols) addRole(c, 'grain key')
  for (const c of entityCols) addRole(c, 'entity id')
  for (const c of timeNames) addRole(c, 'time')
  for (const c of measureCols) addRole(c, 'measure')

  for (const [k, roles] of out.entries()) {
    out.set(k, orderRank(roles))
  }

  return out
}

export const sortOptionalNumber: SortingFn<ColumnProfile> = (rowA, rowB, columnId) => {
  const a = rowA.getValue(columnId) as number | null | undefined
  const b = rowB.getValue(columnId) as number | null | undefined
  const na = a == null || Number.isNaN(a) ? Number.NEGATIVE_INFINITY : a
  const nb = b == null || Number.isNaN(b) ? Number.NEGATIVE_INFINITY : b
  if (na === nb) return 0
  return na < nb ? -1 : 1
}

export function metricScopeLabel(scope: ColumnProfile['metric_scope']): string {
  return scope === 'sample' ? 'sample' : 'full table'
}

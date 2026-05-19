import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnProfile } from '@/api/types'

export const colHelper = createColumnHelper<ColumnProfile>()

export const SEM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'categorical', label: 'Categorical' },
  { value: 'datetime', label: 'Datetime' },
  { value: 'id_like', label: 'ID-like' },
  { value: 'boolean_like', label: 'Boolean' },
  { value: 'text', label: 'Text' },
  { value: 'unknown', label: 'Unknown' },
]

export const CQ_OPTIONS: Array<{ value: 'all' | 'has_flags' | 'critical_only'; label: string }> = [
  { value: 'all', label: 'Any' },
  { value: 'has_flags', label: 'Has flags' },
  { value: 'critical_only', label: 'Critical flags' },
]

export const COLUMN_TOOLBAR_IDS: Array<{ id: string; label: string }> = [
  { id: 'name', label: 'Column' },
  { id: 'type_col', label: 'Type' },
  { id: 'role_col', label: 'Role' },
  { id: 'missing', label: 'Missing' },
  { id: 'unique_pct', label: 'Unique' },
  { id: 'range_col', label: 'Range' },
  { id: 'mean_sort', label: 'Center' },
  { id: 'spread_sort', label: 'Spread' },
  { id: 'top_pct', label: 'Top' },
  { id: 'quality_flags', label: 'Flags' },
]

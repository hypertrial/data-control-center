import type { DatasetProfile } from '@/api/types'

/** Profile-aware suggested questions (row-shape → temporal → grain → measure → quality). */
export function buildSuggestedPrompts(profile: DatasetProfile): string[] {
  const prompts: string[] = []

  prompts.push(`How many rows are in this dataset?`)

  if (profile.primary_temporal_column?.name) {
    prompts.push(`What is the date range of column ${profile.primary_temporal_column.name}?`)
  }

  const grainCols = profile.primary_grain_key_columns?.length
    ? profile.primary_grain_key_columns
    : profile.grain_key_candidates?.[0]?.columns
  if (grainCols?.length) {
    const grainLabel = grainCols.join(', ')
    prompts.push(`How many distinct combinations exist for grain key (${grainLabel})?`)
  }

  const entityCol = profile.entity_id_columns?.[0]?.name
  if (entityCol) {
    prompts.push(`How many distinct values are in entity column ${entityCol}?`)
  }

  const cat = profile.column_profiles.find((c) => c.semantic_type === 'categorical')
  if (cat) {
    prompts.push(`What are the top 10 most frequent values in ${cat.name}?`)
  }

  const measure =
    profile.main_numeric_measures[0] ?? profile.measure_candidates?.[0]?.name
  if (measure) {
    prompts.push(`Show basic summary statistics (min, max, avg) for ${measure}.`)
  }

  const highNull = [...profile.column_profiles].sort((a, b) => b.null_pct - a.null_pct)[0]
  if (highNull && highNull.null_pct > 5) {
    prompts.push(`Which columns have the highest null percentage?`)
  }

  return [...new Set(prompts)].slice(0, 6)
}

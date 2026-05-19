import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DatasetProfile } from '@/api/types'
import { AskHero } from '@/features/ask/AskHero'

const profile: DatasetProfile = {
  dataset_id: 'ds_1',
  name: 't',
  rows: 1,
  columns: 1,
  file_size_bytes: null,
  missing_cell_pct: null,
  duplicate_row_pct: null,
  numeric_column_count: 0,
  categorical_column_count: 0,
  datetime_column_count: 0,
  quality_score: null,
  narrative: '',
  likely_grain: null,
  main_numeric_measures: [],
  structure_version: 'v4',
  temporal_columns: [],
  entity_id_columns: [],
  grain_key_candidates: [],
  primary_grain_key_columns: [],
  primary_temporal_column: null,
  measure_candidates: [],
  structure_warnings: [],
  column_profiles: [],
  quality_issues: [],
}

describe('AskHero', () => {
  it('starts a new chat from the hero CTA', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(<AskHero profile={profile} onPickPrompt={() => {}} onStartNewChat={onStart} />)
    await user.click(screen.getByRole('button', { name: /Start new chat/i }))
    expect(onStart).toHaveBeenCalled()
  })
})

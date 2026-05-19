import type { DatasetProfile } from '@/api/types'
import { chipCols } from './structureSummaryChips'

export function StructureSummary({ profile, onPick }: { profile: DatasetProfile; onPick: (c: string) => void }) {
  const idCols = profile.entity_id_columns.length
    ? profile.entity_id_columns.map((x) => x.name)
    : profile.potential_id_columns
  const keyCols = profile.primary_grain_key_columns.length
    ? profile.primary_grain_key_columns
    : profile.potential_key_columns
  const measureCols = profile.measure_candidates.length
    ? profile.measure_candidates.map((x) => x.name)
    : profile.main_numeric_measures
  const dateLabel = profile.primary_temporal_column?.name ?? profile.primary_date_column
  const dateKind = profile.primary_temporal_column?.kind
  const dateHint = dateKind === 'discrete_period' ? 'discrete period' : dateKind === 'continuous_datetime' ? 'datetime' : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center sm:text-left">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Date</div>
          <div className="mt-0.5 min-w-0 space-y-0.5">
            <div className="break-words font-mono text-xs leading-snug text-white" title={dateLabel ?? ''}>
              {dateLabel ?? '—'}
            </div>
            {dateHint ? (
              <div className="text-[10px] leading-snug text-[hsl(var(--muted))]" title={dateHint}>
                {dateHint}
              </div>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Entities
          </div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{idCols.length}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Grain cols
          </div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{keyCols.length}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-white/[0.03] px-2 py-2 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Measures</div>
          <div className="mt-0.5 tabular-nums text-lg font-semibold text-white">{measureCols.length}</div>
        </div>
      </div>
      {profile.likely_grain ? (
        <div className="rounded-lg border border-border-default bg-white/[0.02] px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
            Grain (natural language)
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-white/90">{profile.likely_grain}</p>
        </div>
      ) : null}
      {profile.structure_warnings.length ? (
        <div
          className="rounded-lg border border-border-default bg-white/[0.02] px-3 py-2"
          title={profile.structure_warnings.join('\n')}
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">Inference notes</div>
          <ul className="mt-1 space-y-1 text-xs text-white/85">
            {profile.structure_warnings.slice(0, 2).map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-2.5 border-t border-border-default pt-3">
        {dateLabel
          ? chipCols('Primary date', [dateLabel], onPick)
          : null}
        {chipCols('Entity IDs', idCols, onPick)}
        {chipCols('Row grain', keyCols, onPick)}
        {chipCols('Main measures', measureCols, onPick, { maxItems: 8 })}
      </div>
    </div>
  )
}

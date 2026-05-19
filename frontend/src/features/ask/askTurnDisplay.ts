import type { AskTurn, DatasetProfile } from '@/api/types'

export function shouldShowStreamingModelNote(
  explanation: string | null,
  answer: string | null,
): boolean {
  return Boolean(explanation?.trim()) && !answer?.trim()
}

export function isPersistedStreamingTurn(
  turns: { turn_id: string }[],
  streamingTurnId: string | null | undefined,
): boolean {
  if (!streamingTurnId) return false
  return turns.some((t) => t.turn_id === streamingTurnId)
}

/** Follow-up prompt chips after a completed turn. */
export function buildFollowUps(turn: AskTurn, profile: DatasetProfile | undefined): string[] {
  const out: string[] = []
  if (!profile) return out

  const entityCol = profile.entity_id_columns?.[0]?.name
  if (entityCol && turn.query_result && !turn.query_result.error) {
    out.push(`Break down the last result by ${entityCol}`)
  }

  const temporal = profile.primary_temporal_column?.name
  if (temporal && turn.sql) {
    out.push(`Filter the same query to the most recent period in ${temporal}`)
  }

  const grainCols = profile.primary_grain_key_columns
  if (grainCols?.length && turn.answer) {
    out.push(`Show null percentage for columns in the grain (${grainCols.join(', ')})`)
  }

  if (turn.sql && out.length < 3) {
    out.push(`Explain how this SQL was derived in simpler terms`)
  }

  return [...new Set(out)].slice(0, 3)
}

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

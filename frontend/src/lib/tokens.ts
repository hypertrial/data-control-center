export type SeverityKey = 'critical' | 'warning' | 'info' | 'ok'

/** Map 0–100 quality score to severity for color (UI convention). */
export function qualityScoreSeverity(score: number | null | undefined): SeverityKey {
  if (score == null) return 'info'
  if (score < 40) return 'critical'
  if (score < 70) return 'warning'
  return 'ok'
}

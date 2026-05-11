/** Design tokens: severity → CSS variable names (HSL triples, no hsl() wrapper). */
export const severityCssVar = {
  critical: '--severity-critical',
  warning: '--severity-warning',
  info: '--severity-info',
  ok: '--severity-ok',
} as const

export type SeverityKey = keyof typeof severityCssVar

/** Map 0–100 quality score to severity for color (UI convention). */
export function qualityScoreSeverity(score: number | null | undefined): SeverityKey {
  if (score == null) return 'info'
  if (score < 40) return 'critical'
  if (score < 70) return 'warning'
  return 'ok'
}

export const cardPadding = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
} as const

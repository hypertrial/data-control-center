/** Truncate for chart axis labels; full string remains in tooltips. */
export function shortenChartLabel(raw: string, maxChars: number): string {
  const s = raw.trim()
  if (s.length <= maxChars) return s
  return `${s.slice(0, Math.max(1, maxChars - 1))}…`
}

export function estimateChartYAxisGutterPx(names: string[], cap = 300): number {
  const longest = names.reduce((m, n) => Math.max(m, n.length), 10)
  return Math.min(cap, Math.round(48 + longest * 6.5))
}

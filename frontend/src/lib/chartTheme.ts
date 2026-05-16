/** Theme tokens in `index.css` are space-separated HSL triples; ECharts ignores `var()`, so resolve here. */
export function hslFromRootVar(name: string, alpha?: number): string {
  if (typeof document === 'undefined') {
    return alpha != null ? 'hsla(0, 0%, 45%, 0.35)' : 'hsl(0, 0%, 45%)'
  }
  const triple = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!triple) return alpha != null ? 'hsla(0, 0%, 45%, 0.35)' : 'hsl(0, 0%, 45%)'
  return alpha != null ? `hsl(${triple} / ${alpha})` : `hsl(${triple})`
}

export function chartPalette(): string[] {
  return [
    hslFromRootVar('--accent'),
    hslFromRootVar('--accent-cyan'),
    hslFromRootVar('--accent-orange'),
    hslFromRootVar('--accent-green'),
    hslFromRootVar('--fg-muted'),
  ]
}

export const chartGrid = {
  left: 8,
  right: 16,
  top: 16,
  bottom: 8,
  containLabel: true,
} as const

function borderColorResolved(): string {
  if (typeof document === 'undefined') return 'rgba(255,255,255,0.12)'
  const triple = getComputedStyle(document.documentElement).getPropertyValue('--border-triple').trim()
  const a = getComputedStyle(document.documentElement).getPropertyValue('--border-alpha').trim()
  const alpha = a || '0.12'
  return triple ? `hsl(${triple} / ${alpha})` : 'rgba(255,255,255,0.12)'
}

export function chartTooltip(): Record<string, unknown> {
  return {
    backgroundColor: hslFromRootVar('--surface-elevated'),
    borderColor: borderColorResolved(),
    borderWidth: 1,
    textStyle: { color: hslFromRootVar('--fg'), fontSize: 12 },
  }
}

/** Axis labels on dark surfaces; ECharts defaults are illegible on our cards without an explicit color. */
export function chartAxisLabelStyle(): { color: string; fontSize: number } {
  return { color: hslFromRootVar('--fg-muted'), fontSize: 11 }
}

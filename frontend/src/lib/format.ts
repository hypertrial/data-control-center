/** Locale-aware integer count. */
export function formatCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString()
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** Percent 0–100 with sensible decimals (e.g. 14.88%). */
export function formatPercent(p: number | null | undefined, decimals = 2): string {
  if (p == null || Number.isNaN(p)) return '—'
  return `${p.toFixed(decimals)}%`
}

const edaNumericDisplay = new Intl.NumberFormat('en-US', {
  maximumSignificantDigits: 4,
  maximumFractionDigits: 4,
  useGrouping: false,
})

/** Compact display for profiler numeric strings (mean, std, quartiles, min/max); non-finite parse falls back to raw. */
export function formatEdaNumericString(raw: string | null | undefined): string {
  if (raw == null) return '—'
  const trimmed = raw.trim()
  if (trimmed === '') return '—'
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return raw
  return edaNumericDisplay.format(n)
}

/** Short relative time from epoch ms. */
export function formatRelativeTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function stripFileExtension(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return name
  return name.slice(0, i)
}

export function formatDatasetFormat(fmt: string | null | undefined): string {
  if (!fmt) return '—'
  return fmt.toUpperCase()
}

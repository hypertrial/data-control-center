/** True when a thrown error is likely a dev-time transport failure (proxy drop, reload, abort). */
export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return true
  const m = error.message.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network error') ||
    m.includes('load failed') ||
    m.includes('network request failed') ||
    m.includes('fetch failed')
  )
}

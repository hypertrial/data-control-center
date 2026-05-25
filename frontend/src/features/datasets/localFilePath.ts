/** Absolute path when the host exposes it (e.g. some desktop shells); otherwise null. */
export function resolveLocalFilePath(file: File): string | null {
  const path = (file as File & { path?: string }).path
  if (typeof path === 'string' && path.trim()) return path.trim()
  return null
}

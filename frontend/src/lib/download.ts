function clickDownload(href: string, filename: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  clickDownload(url, filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function safeDownloadName(...parts: Array<string | null | undefined>): string {
  return (
    parts
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'data-control-center'
  )
}

export function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type }), filename)
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('Invalid chart image')
  const metadata = dataUrl.slice(5, comma)
  const payload = dataUrl.slice(comma + 1)
  const mime = metadata.split(';', 1)[0] || 'application/octet-stream'
  const binary = metadata.includes(';base64') ? window.atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  downloadBlob(new Blob([bytes], { type: mime }), filename)
}

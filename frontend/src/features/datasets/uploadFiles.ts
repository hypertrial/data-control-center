/** Mirrors backend `SUPPORTED_EXTENSIONS` for client-side filtering. */
const UPLOAD_EXT = new Set(['.csv', '.tsv', '.parquet', '.json', '.jsonl', '.ndjson'])

export const ACCEPT_ATTR = '.csv,.tsv,.parquet,.json,.jsonl,.ndjson'

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function normalizeUploadFile(file: File): File {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  if (rel && rel.length > 0) {
    const safe = rel.replace(/[/\\]/g, '__')
    return new File([file], safe, { type: file.type, lastModified: file.lastModified })
  }
  return file
}

export function filterSupportedFiles(files: File[]): File[] {
  return files.map(normalizeUploadFile).filter((f) => UPLOAD_EXT.has(extOf(f.name)))
}

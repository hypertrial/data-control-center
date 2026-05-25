/** Mirrors backend supported upload extensions for client-side filtering. */
const UPLOAD_EXT = new Set(['.csv', '.tsv', '.parquet', '.json', '.jsonl', '.ndjson'])
const DUCKDB_EXT = '.duckdb'

/** Browser file inputs for tabular uploads only (no DuckDB — use Import DuckDB). */
export const TABULAR_ACCEPT_ATTR = '.csv,.tsv,.parquet,.json,.jsonl,.ndjson'

/** @deprecated Use TABULAR_ACCEPT_ATTR for inputs; DuckDB uses native pick. */
export const ACCEPT_ATTR = TABULAR_ACCEPT_ATTR

export const UNSUPPORTED_FILES_MESSAGE =
  'No supported files (.csv, .tsv, .parquet, .json, .jsonl, .ndjson).'

export const DUCKDB_USE_IMPORT_MESSAGE =
  'Use Import DuckDB to open a database file. Browser upload cannot access file paths on disk.'

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

export function filterDuckDbFiles(files: File[]): File[] {
  return files.map(normalizeUploadFile).filter((f) => extOf(f.name) === DUCKDB_EXT)
}

export function partitionIncomingFiles(files: File[]): { dataFiles: File[]; duckDbFiles: File[] } {
  const normalized = files.map(normalizeUploadFile)
  const dataFiles: File[] = []
  const duckDbFiles: File[] = []
  for (const file of normalized) {
    const ext = extOf(file.name)
    if (ext === DUCKDB_EXT) duckDbFiles.push(file)
    else if (UPLOAD_EXT.has(ext)) dataFiles.push(file)
  }
  return { dataFiles, duckDbFiles }
}

export function hasIngestibleFiles(files: File[]): boolean {
  const { dataFiles, duckDbFiles } = partitionIncomingFiles(files)
  return dataFiles.length > 0 || duckDbFiles.length > 0
}

export function hasTabularIngestibleFiles(files: File[]): boolean {
  return partitionIncomingFiles(files).dataFiles.length > 0
}

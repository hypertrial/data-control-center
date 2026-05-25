/** Default Parquet export stem; mirrors backend `_export_stem` when alias is omitted. */
export function defaultDuckDbExportAlias(
  dbFilename: string,
  rel: { schema: string; name: string },
): string {
  const stem = dbFilename.replace(/\.duckdb$/i, '') || 'duckdb'
  return `${stem}__${rel.schema}__${rel.name}`
}

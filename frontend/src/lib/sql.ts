/** DuckDB-oriented SQL quoting helpers for generated snippets (UI → `/api/query`). */

export function quoteIdent(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name
  return `"${name.replaceAll('"', '""')}"`
}

export function quoteLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const s = String(value)
  return `'${s.replaceAll("'", "''")}'`
}

export function viewNameForDataset(datasetId: string): string {
  return `v_${datasetId}`
}

export function sqlSelectStarFromView(datasetId: string, limit = 50): string {
  const v = viewNameForDataset(datasetId)
  return `SELECT * FROM ${v} LIMIT ${limit};`
}

export function sqlSelectColumnFromView(datasetId: string, column: string, limit = 100): string {
  const v = viewNameForDataset(datasetId)
  const col = quoteIdent(column)
  return `SELECT ${col} FROM ${v} LIMIT ${limit};`
}

export function sqlWherePkSample(datasetId: string, column: string, value: unknown, limit = 50): string {
  const v = viewNameForDataset(datasetId)
  return `SELECT * FROM ${v} WHERE ${quoteIdent(column)} = ${quoteLiteral(value)} LIMIT ${limit};`
}

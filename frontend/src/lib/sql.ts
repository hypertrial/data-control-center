/** DuckDB-oriented SQL quoting helpers for generated snippets (UI → `/api/query`). */
import { format } from 'sql-formatter'

const ANALYTICS_SQL_FORMAT_OPTIONS = {
  language: 'duckdb',
  keywordCase: 'lower',
  tabWidth: 4,
} as const

export function formatAnalyticsSql(sql: string): string {
  return format(sql, ANALYTICS_SQL_FORMAT_OPTIONS)
}

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

export function sqlSelectStarFromView(viewName: string, limit = 50): string {
  const v = quoteIdent(viewName)
  return formatAnalyticsSql(`SELECT * FROM ${v} LIMIT ${limit};`)
}

export function sqlSelectColumnFromView(viewName: string, column: string, limit = 100): string {
  const v = quoteIdent(viewName)
  const col = quoteIdent(column)
  return formatAnalyticsSql(`SELECT ${col} FROM ${v} LIMIT ${limit};`)
}

export function sqlWherePkSample(viewName: string, column: string, value: unknown, limit = 50): string {
  const v = quoteIdent(viewName)
  return formatAnalyticsSql(`SELECT * FROM ${v} WHERE ${quoteIdent(column)} = ${quoteLiteral(value)} LIMIT ${limit};`)
}

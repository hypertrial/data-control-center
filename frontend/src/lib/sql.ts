/** DuckDB-oriented SQL quoting helpers for generated snippets (UI → `/api/query`). */
import { format } from 'sql-formatter'

const ANALYTICS_SQL_FORMAT_OPTIONS = {
  language: 'duckdb',
  keywordCase: 'lower',
  tabWidth: 4,
} as const

const TOP_LEVEL_CLAUSES = new Set([
  'with',
  'select',
  'from',
  'where',
  'group by',
  'having',
  'order by',
  'limit',
  'offset',
  'union',
  'intersect',
  'except',
])

function isIndented(line: string): boolean {
  return /^[ \t]+/.test(line)
}

function isTopLevelClause(line: string): boolean {
  return TOP_LEVEL_CLAUSES.has(line.trim().toLowerCase())
}

function collapseSimpleClauseBodies(formattedSql: string): string {
  const lines = formattedSql.split('\n')
  const collapsed: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (!isTopLevelClause(line)) {
      collapsed.push(line)
      continue
    }

    const clause = line.trim()
    const body: string[] = []
    let j = i + 1
    while (j < lines.length) {
      const next = lines[j] ?? ''
      if (!isIndented(next)) break
      body.push(next.trim())
      j += 1
    }

    if (body.length === 1) {
      collapsed.push(`${clause} ${body[0]}`)
      i = j - 1
      continue
    }

    collapsed.push(line)
  }

  return collapsed.join('\n')
}

function ensureTrailingSemicolon(formattedSql: string): string {
  const trimmed = formattedSql.trimEnd()
  if (!trimmed) return trimmed
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

export function formatAnalyticsSql(sql: string): string {
  return ensureTrailingSemicolon(collapseSimpleClauseBodies(format(sql, ANALYTICS_SQL_FORMAT_OPTIONS)))
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

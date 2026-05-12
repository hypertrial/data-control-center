export function isNumericAskCell(typeByCol: Record<string, string>, col: string) {
  const t = (typeByCol[col] || '').toUpperCase()
  return /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|UBIGINT|HUGEINT/i.test(t)
}

/** Remove a trailing `LIMIT n` clause for opening in SQL editor without row cap. */
export function stripTrailingLimit(sql: string): string {
  return sql.replace(/\s+LIMIT\s+\d+\s*$/i, '').trim()
}

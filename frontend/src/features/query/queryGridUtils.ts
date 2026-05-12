import type { QueryResultColumn } from '@/api/types'

export type CellCoord = { row: number; col: number }

/** DuckDB / SQL-ish physical types from API (may be null). */
export function isNumericSqlType(type: string | null | undefined): boolean {
  const t = (type || '').toUpperCase()
  return /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|UBIGINT|HUGEINT/i.test(t)
}

/** Display string for grid cell (not including special NULL styling). */
export function formatCellDisplay(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Plain value for clipboard / export (no "NULL" label). */
export function formatCellExport(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Pretty JSON for cell detail dialog. */
export function formatCellDetail(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

export function isNullishCell(v: unknown): boolean {
  return v === null || v === undefined
}

export function normalizeSelection(a: CellCoord, b: CellCoord): { r0: number; r1: number; c0: number; c1: number } {
  return {
    r0: Math.min(a.row, b.row),
    r1: Math.max(a.row, b.row),
    c0: Math.min(a.col, b.col),
    c1: Math.max(a.col, b.col),
  }
}

export function isInSelection(row: number, col: number, sel: { r0: number; r1: number; c0: number; c1: number }): boolean {
  return row >= sel.r0 && row <= sel.r1 && col >= sel.c0 && col <= sel.c1
}

function escapeCsvField(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Tab-separated selection. Column index 0 = row number; 1..n map to `columns[0..]`.
 * When `selection` is omitted, copies all data columns for all rows (no row numbers).
 */
export function queryResultToTsv(
  columns: QueryResultColumn[],
  rows: Record<string, unknown>[],
  selection?: { r0: number; r1: number; c0: number; c1: number },
): string {
  const lines: string[] = []
  const r0 = selection?.r0 ?? 0
  const r1 = selection?.r1 ?? Math.max(0, rows.length - 1)
  const c0 = selection?.c0 ?? 1
  const c1 = selection?.c1 ?? columns.length

  for (let r = r0; r <= r1; r++) {
    const row = rows[r]
    if (!row) continue
    const parts: string[] = []
    for (let c = c0; c <= c1; c++) {
      if (c === 0) {
        parts.push(String(r + 1))
      } else {
        const name = columns[c - 1]?.name
        if (name) parts.push(formatCellExport(row[name]))
      }
    }
    lines.push(parts.join('\t'))
  }
  return lines.join('\n')
}

export function queryResultToCsv(columns: QueryResultColumn[], rows: Record<string, unknown>[]): string {
  const names = columns.map((c) => c.name)
  const lines = [names.map((n) => escapeCsvField(n)).join(',')]
  for (const row of rows) {
    lines.push(names.map((n) => escapeCsvField(formatCellExport(row[n]))).join(','))
  }
  return lines.join('\n')
}

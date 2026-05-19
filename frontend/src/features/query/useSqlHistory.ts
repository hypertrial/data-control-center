const HISTORY_KEY = 'dcc-sql-history'
export const SQL_HISTORY_CAP = 10

export function loadSqlHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveSqlHistory(entries: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, SQL_HISTORY_CAP)))
}

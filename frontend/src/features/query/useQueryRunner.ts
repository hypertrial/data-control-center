import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'

export function formatRunDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function useQueryRunner({
  sqlText,
  selectedSql,
  maxRows,
  getSelectedText,
  pushHistory,
}: {
  sqlText: string
  selectedSql: string
  maxRows: number
  getSelectedText: () => string
  pushHistory: (sql: string) => void
}) {
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [runFinishedAt, setRunFinishedAt] = useState<number | null>(null)
  const [runElapsedMs, setRunElapsedMs] = useState<number | null>(null)
  const runStartedAtRef = useRef<number | null>(null)

  const runMutation = useMutation({
    mutationFn: api.runQuery,
    onMutate: () => {
      const started = Date.now()
      runStartedAtRef.current = started
      setRunStartedAt(started)
      setRunFinishedAt(null)
      setRunElapsedMs(0)
    },
    onSettled: () => {
      const finished = Date.now()
      const started = runStartedAtRef.current
      setRunFinishedAt(finished)
      setRunElapsedMs(started != null ? finished - started : null)
    },
  })

  const execRun = useCallback(() => {
    const sql = selectedSql.trim() || getSelectedText().trim() || sqlText
    runMutation.mutate({ sql, max_rows: maxRows > 0 ? maxRows : null })
    pushHistory(sql)
  }, [getSelectedText, maxRows, pushHistory, runMutation, selectedSql, sqlText])

  useEffect(() => {
    if (!runMutation.isPending || runStartedAt == null) return
    const id = window.setInterval(() => setRunElapsedMs(Date.now() - runStartedAt), 200)
    return () => window.clearInterval(id)
  }, [runMutation.isPending, runStartedAt])

  return {
    execRun,
    runElapsedMs,
    runFinishedAt,
    runMutation,
  }
}

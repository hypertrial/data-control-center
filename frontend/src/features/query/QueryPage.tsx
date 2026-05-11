import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { sql } from '@codemirror/lang-sql'
import { keymap } from '@codemirror/view'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ColumnProfile, DatasetSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { PageContainer } from '@/components/ui/section'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const HISTORY_KEY = 'dcc-sql-history'
const HISTORY_CAP = 10

/** Module scope so React hook immutability rules do not apply; updated in effect to latest exec. */
const execRunHolder: { run: () => void } = { run: () => {} }

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveHistory(entries: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_CAP)))
}

export function QueryPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const sqlInjectTick = useUiStore((s) => s.sqlInjectTick)

  const [sqlText, setSqlText] = useState(() => (activeId ? `SELECT * FROM v_${activeId} LIMIT 50;` : 'SELECT 1;'))
  const [maxRows, setMaxRows] = useState(1000)
  const [history, setHistory] = useState<string[]>(() => loadHistory())
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const cmRef = useRef<ReactCodeMirrorRef>(null)

  const dq = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })

  const insertAtCursor = useCallback((fragment: string) => {
    const view = cmRef.current?.view
    if (!view) {
      setSqlText((s) => s + fragment)
      return
    }
    const pos = view.state.selection.main.head
    view.dispatch({
      changes: { from: pos, to: pos, insert: fragment },
      selection: { anchor: pos + fragment.length },
    })
    view.focus()
  }, [])

  const runMutation = useMutation({ mutationFn: api.runQuery })

  const pushHistory = useCallback((sql: string) => {
    setHistory((prev) => {
      const next = [sql, ...prev.filter((x) => x !== sql)].slice(0, HISTORY_CAP)
      saveHistory(next)
      return next
    })
  }, [])

  const execRun = useCallback(() => {
    runMutation.mutate({ sql: sqlText, max_rows: maxRows })
    pushHistory(sqlText)
  }, [runMutation, sqlText, maxRows, pushHistory])

  useEffect(() => {
    execRunHolder.run = execRun
  }, [execRun])

  const processedInject = useRef(0)
  const prevActive = useRef<string | null>(activeId)

  useEffect(() => {
    const applyPendingOrTemplate = () => {
      if (sqlInjectTick > processedInject.current) {
        processedInject.current = sqlInjectTick
        const pending = useUiStore.getState().takePendingQuery()
        if (pending) {
          setSqlText(pending)
          prevActive.current = activeId
          return
        }
      }
      if (prevActive.current !== activeId) {
        prevActive.current = activeId
        if (activeId) setSqlText(`SELECT * FROM v_${activeId} LIMIT 50;`)
        else setSqlText('SELECT 1;')
      }
    }
    queueMicrotask(applyPendingOrTemplate)
  }, [sqlInjectTick, activeId])

  const extensions = useMemo(
    () => [
      vscodeDark,
      sql(),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            execRunHolder.run()
            return true
          },
        },
      ]),
    ],
    [],
  )

  const viewHint = activeId != null ? `v_${activeId}` : 'v_ds_*'

  const toggleDs = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  return (
    <PageContainer>
      <p className="text-xs text-[hsl(var(--muted))]">
        Dataset view alias: <span className="font-mono text-white">{viewHint}</span>. Press{' '}
        <kbd className="rounded border border-white/20 px-1 font-mono text-[10px]">⌘</kbd>+
        <kbd className="rounded border border-white/20 px-1 font-mono text-[10px]">Enter</kbd> to run.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(200px,28%)]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-white/10">
            <CodeMirror
              value={sqlText}
              height="200px"
              theme="none"
              extensions={extensions}
              onChange={(v) => setSqlText(v)}
              ref={cmRef}
              className="text-sm [&_.cm-editor]:rounded-lg"
              basicSetup={{ lineNumbers: true, foldGutter: false }}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[120px] flex-1">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
                max_rows
              </div>
              <Input
                type="number"
                value={maxRows}
                onChange={(e) => setMaxRows(Number(e.target.value) || 0)}
              />
            </div>
            <Button type="button" onClick={() => execRun()} disabled={runMutation.isPending}>
              Run query
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.alert('SQL formatter coming soon.')
              }}
            >
              Format
            </Button>
            <div className="min-w-[140px]">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted))]">
                History
              </div>
              <select
                className="h-9 w-full rounded-md border border-white/15 bg-black/30 px-2 text-sm"
                value=""
                onChange={(e) => {
                  const v = e.target.value
                  if (v) setSqlText(v)
                  e.target.value = ''
                }}
              >
                <option value="">Pick previous query…</option>
                {history.map((h, i) => (
                  <option key={i} value={h}>
                    {h.slice(0, 72)}
                    {h.length > 72 ? '…' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="text-xs font-semibold text-[hsl(var(--muted))]">Schema</div>
          <div className="mt-2 max-h-[320px] space-y-2 overflow-auto text-xs">
            {(dq.data ?? []).map((ds: DatasetSummary) => (
              <SchemaDatasetBlock
                key={ds.dataset_id}
                summary={ds}
                expanded={!!expanded[ds.dataset_id]}
                onToggle={() => toggleDs(ds.dataset_id)}
                onInsert={(frag) => insertAtCursor(frag)}
              />
            ))}
            {dq.data?.length === 0 && <div className="text-[hsl(var(--muted))]">No datasets.</div>}
          </div>
        </div>
      </div>

      {runMutation.isPending && <div className="text-sm text-[hsl(var(--muted))]">Running…</div>}
      {runMutation.isError && <QueryErrorBanner message={(runMutation.error as Error).message} />}

      {runMutation.data?.error && <QueryErrorBanner message={runMutation.data.error} />}
      {runMutation.data && !runMutation.data.error && (
        <div className="space-y-2">
          <div className="text-xs text-[hsl(var(--muted))]">
            <span className="tabular-nums">{runMutation.data.row_count}</span> rows
            {runMutation.data.truncated ? ' (truncated)' : ''}
          </div>
          <Table>
            <caption className="sr-only">Query result</caption>
            <THead>
              <TR>
                {runMutation.data.columns.map((c) => (
                  <TH key={c.name} scope="col">
                    {c.name}
                    <span className="ml-1 text-[10px] font-normal text-[hsl(var(--muted))]">{c.type}</span>
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {runMutation.data.rows.map((row, i) => (
                <TR key={i}>
                  {runMutation.data!.columns.map((c) => (
                    <TD key={c.name} className="max-w-[240px] truncate font-mono text-xs">
                      {formatCell(row[c.name])}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </PageContainer>
  )
}

function SchemaDatasetBlock({
  summary,
  expanded,
  onToggle,
  onInsert,
}: {
  summary: DatasetSummary
  expanded: boolean
  onToggle: () => void
  onInsert: (s: string) => void
}) {
  const pq = useQuery({
    queryKey: ['profile', summary.dataset_id],
    queryFn: () => api.getProfile(summary.dataset_id),
    enabled: expanded,
  })

  const cols: ColumnProfile[] = pq.data?.column_profiles ?? []
  const viewName = `v_${summary.dataset_id}`

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-white/5"
      >
        <span className="truncate font-mono text-white/90">{summary.name}</span>
        <span className="shrink-0 text-[hsl(var(--muted))]">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <ul className="max-h-48 overflow-auto border-t border-white/10 px-2 py-1">
          {pq.isLoading && <li className="py-1 text-[hsl(var(--muted))]">Loading…</li>}
          {pq.isError && <li className="py-1 text-red-300">{(pq.error as Error).message}</li>}
          {cols.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left font-mono hover:bg-white/10',
                )}
                onClick={() => onInsert(`${viewName}.${quoteIdent(c.name)} `)}
                title="Insert at cursor"
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-[10px] text-[hsl(var(--muted))]">{c.physical_type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function quoteIdent(name: string) {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name
  return `"${name.replaceAll('"', '""')}"`
}

function formatCell(v: unknown) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

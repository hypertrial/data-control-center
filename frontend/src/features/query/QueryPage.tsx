import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { sql } from '@codemirror/lang-sql'
import { Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'sql-formatter'
import { ChevronDown, ChevronRight, History, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { ColumnProfile, DatasetSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/ui/section'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { quoteIdent, sqlSelectStarFromView } from '@/lib/sql'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { SqlResultsGrid } from '@/features/query/SqlResultsGrid'

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
  const qc = useQueryClient()
  const activeId = useUiStore((s) => s.activeDatasetId)
  const sqlInjectTick = useUiStore((s) => s.sqlInjectTick)

  const [sqlText, setSqlText] = useState(() => 'SELECT 1;')
  const [maxRows, setMaxRows] = useState(1000)
  const [history, setHistory] = useState<string[]>(() => loadHistory())
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const cmRef = useRef<ReactCodeMirrorRef>(null)

  const dq = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const savedQ = useQuery({ queryKey: ['saved-queries'], queryFn: api.listSavedQueries })

  const activeSummary = useMemo(
    () => dq.data?.find((d) => d.dataset_id === activeId),
    [dq.data, activeId],
  )
  const activeViewName = activeSummary?.view_name

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

  const createSaved = useMutation({
    mutationFn: () => api.createSavedQuery({ name: saveName.trim(), sql: sqlText }),
    onSuccess: () => {
      toast.success('Saved query stored')
      setSaveOpen(false)
      setSaveName('')
      void qc.invalidateQueries({ queryKey: ['saved-queries'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pushHistory = useCallback((sql: string) => {
    setHistory((prev) => {
      const next = [sql, ...prev.filter((x) => x !== sql)].slice(0, HISTORY_CAP)
      saveHistory(next)
      return next
    })
  }, [])

  const execRun = useCallback(() => {
    runMutation.mutate({ sql: sqlText, max_rows: maxRows > 0 ? maxRows : null })
    pushHistory(sqlText)
  }, [runMutation, sqlText, maxRows, pushHistory])

  useEffect(() => {
    execRunHolder.run = execRun
  }, [execRun])

  const processedInject = useRef(0)
  const prevTemplateKey = useRef<string>('')

  useEffect(() => {
    const applyPendingOrTemplate = () => {
      if (sqlInjectTick > processedInject.current) {
        processedInject.current = sqlInjectTick
        const pending = useUiStore.getState().takePendingQuery()
        if (pending) {
          setSqlText(pending)
          prevTemplateKey.current =
            !activeId ? 'idle' : activeViewName ? `${activeId}\0${activeViewName}` : `pending:${activeId}`
          return
        }
      }
      const templateKey =
        !activeId ? 'idle' : activeViewName ? `${activeId}\0${activeViewName}` : `pending:${activeId}`

      if (templateKey.startsWith('pending:')) {
        if (prevTemplateKey.current !== templateKey) {
          prevTemplateKey.current = templateKey
          setSqlText('SELECT 1;')
        }
        return
      }

      if (prevTemplateKey.current !== templateKey) {
        prevTemplateKey.current = templateKey
        if (!activeId) setSqlText('SELECT 1;')
        else if (activeViewName) setSqlText(sqlSelectStarFromView(activeViewName, 50))
      }
    }
    queueMicrotask(applyPendingOrTemplate)
  }, [sqlInjectTick, activeId, activeViewName])

  const extensions = useMemo(
    () => [
      vscodeDark,
      sql(),
      // Highest precedence + DOM handler so Cmd+Enter works on Mac even when default uiw/CodeMirror keymaps win.
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (event.defaultPrevented) return false
            if (event.key !== 'Enter') return false
            if (!event.metaKey && !event.ctrlKey) return false
            event.preventDefault()
            execRunHolder.run()
            return true
          },
        }),
      ),
    ],
    [],
  )

  const viewHint =
    activeViewName != null && activeViewName !== ''
      ? quoteIdent(activeViewName)
      : activeId != null
        ? '(loading view name…)'
        : '<dataset_table>'

  const toggleDs = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  return (
    <PageContainer>
      <p className="text-xs text-[hsl(var(--muted))]">
        Dataset view alias: <span className="font-mono text-white">{viewHint}</span>. Press{' '}
        <kbd className="rounded border border-border-default px-1 font-mono text-[10px]">⌘</kbd>+
        <kbd className="rounded border border-border-default px-1 font-mono text-[10px]">Enter</kbd> to run.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(200px,28%)]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-border-default">
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
                try {
                  setSqlText(format(sqlText, { language: 'duckdb' }))
                  toast.success('SQL formatted')
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
            >
              Format
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="gap-1">
                  <History className="h-3.5 w-3.5" />
                  Snippets
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-h-80 w-96 overflow-y-auto p-0" align="start">
                <div className="border-b border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                  Recent
                </div>
                <ul className="p-1">
                  {history.length === 0 ? (
                    <li className="px-2 py-2 text-xs text-fg-muted">No local history yet.</li>
                  ) : (
                    history.map((h, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                          onClick={() => setSqlText(h)}
                        >
                          {h.slice(0, 120)}
                          {h.length > 120 ? '…' : ''}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="border-b border-t border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                  Saved queries
                </div>
                <ul className="p-1">
                  {(savedQ.data ?? []).length === 0 ? (
                    <li className="px-2 py-2 text-xs text-fg-muted">None yet — use Save query.</li>
                  ) : (
                    (savedQ.data ?? []).map((q) => (
                      <li key={q.saved_id}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                          onClick={() => setSqlText(q.sql)}
                        >
                          <span className="font-medium text-fg">{q.name}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-fg-muted">
                            {q.sql.slice(0, 96)}
                            {q.sql.length > 96 ? '…' : ''}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </PopoverContent>
            </Popover>
            <Button type="button" variant="secondary" onClick={() => setSaveOpen(true)}>
              Save query
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => {
                void navigator.clipboard.writeText(sqlText)
                toast.success('SQL copied')
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy SQL
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border-default bg-black/20 p-3">
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
        <SqlResultsGrid queryResult={runMutation.data} busy={runMutation.isPending} />
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title="Save query" className="max-w-md">
          <div className="space-y-3">
            <div>
              <label htmlFor="dcc-save-q-name" className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                Name
              </label>
              <Input
                id="dcc-save-q-name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. Monthly revenue check"
                className="mt-1"
              />
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={!saveName.trim() || createSaved.isPending}
              onClick={() => createSaved.mutate()}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
  const viewIdent = quoteIdent(summary.view_name)

  return (
    <div className="rounded-lg border border-border-default bg-white/[0.03]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-white/5"
      >
        <span className="truncate font-mono text-white/90">{summary.name}</span>
        <span className="shrink-0 text-fg-muted">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <ul className="max-h-48 overflow-auto border-t border-border-default px-2 py-1">
          {pq.isLoading && <li className="py-1 text-[hsl(var(--muted))]">Loading…</li>}
          {pq.isError && <li className="py-1 text-red-300">{(pq.error as Error).message}</li>}
          {cols.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left font-mono hover:bg-white/10',
                )}
                onClick={() => onInsert(`${viewIdent}.${quoteIdent(c.name)} `)}
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

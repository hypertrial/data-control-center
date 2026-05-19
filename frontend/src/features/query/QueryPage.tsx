import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Copy, History, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { DatasetSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/ui/section'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { formatAnalyticsSql, quoteIdent } from '@/lib/sql'
import { formatCount } from '@/lib/format'
import { useResizableSplit } from '@/hooks/useResizableSplit'
import { useUiStore } from '@/store/uiStore'
import { SchemaDatasetBlock } from '@/features/query/SchemaDatasetBlock'
import { SqlActiveDatasetChip } from '@/features/query/SqlActiveDatasetChip'
import { SqlEditor, type SqlEditorHandle } from '@/features/query/SqlEditor'
import { SqlResultsGrid } from '@/features/query/SqlResultsGrid'
import { useDefaultSqlTemplate } from '@/features/query/useDefaultSqlTemplate'
import { loadSqlHistory, saveSqlHistory, SQL_HISTORY_CAP } from '@/features/query/useSqlHistory'

function formatRunDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function QueryPage() {
  const qc = useQueryClient()
  const activeId = useUiStore((s) => s.activeDatasetId)
  const sqlInjectTick = useUiStore((s) => s.sqlInjectTick)
  const sqlEditorHeight = useUiStore((s) => s.sqlEditorHeight)
  const setSqlEditorHeight = useUiStore((s) => s.setSqlEditorHeight)
  const schemaCollapsed = useUiStore((s) => s.sqlSchemaCollapsed)
  const setSchemaCollapsed = useUiStore((s) => s.setSqlSchemaCollapsed)

  const [sqlText, setSqlText] = useState(() => 'select 1;')
  const [maxRows, setMaxRows] = useState(1000)
  const [history, setHistory] = useState<string[]>(() => loadSqlHistory())
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [otherDatasetsOpen, setOtherDatasetsOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [selectedSql, setSelectedSql] = useState('')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [runFinishedAt, setRunFinishedAt] = useState<number | null>(null)
  const [runElapsedMs, setRunElapsedMs] = useState<number | null>(null)

  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const sqlEditorHandleRef = useRef<SqlEditorHandle>(null)
  const saveNameRef = useRef<HTMLInputElement>(null)

  const dq = useQuery({ queryKey: ['datasets'], queryFn: api.listDatasets })
  const savedQ = useQuery({ queryKey: ['saved-queries'], queryFn: api.listSavedQueries })

  const activeSummary = useMemo(
    () => dq.data?.find((d) => d.dataset_id === activeId),
    [dq.data, activeId],
  )
  const activeViewName = activeSummary?.view_name

  useDefaultSqlTemplate(sqlText, setSqlText, activeId, activeViewName, sqlInjectTick)

  const { handleProps } = useResizableSplit({
    height: sqlEditorHeight,
    onHeightChange: setSqlEditorHeight,
  })

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

  const deleteSaved = useMutation({
    mutationFn: (savedId: string) => api.deleteSavedQuery(savedId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-queries'] })
      toast.success('Saved query removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createSaved = useMutation({
    mutationFn: () => api.createSavedQuery({ name: saveName.trim(), sql: sqlText }),
    onSuccess: () => {
      toast.success('Saved query stored')
      setSaveOpen(false)
      setSaveName('')
      setSaveDescription('')
      void qc.invalidateQueries({ queryKey: ['saved-queries'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pushHistory = useCallback((sql: string) => {
    setHistory((prev) => {
      const next = [sql, ...prev.filter((x) => x !== sql)].slice(0, SQL_HISTORY_CAP)
      saveSqlHistory(next)
      return next
    })
  }, [])

  const removeHistory = useCallback((sql: string) => {
    setHistory((prev) => {
      const next = prev.filter((x) => x !== sql)
      saveSqlHistory(next)
      return next
    })
  }, [])

  const execRun = useCallback(() => {
    const sql =
      selectedSql.trim() || sqlEditorHandleRef.current?.getSelectedText().trim() || sqlText
    runMutation.mutate({ sql, max_rows: maxRows > 0 ? maxRows : null })
    pushHistory(sql)
  }, [runMutation, selectedSql, sqlText, maxRows, pushHistory])

  const hasSelection = selectedSql.trim().length > 0

  const formatSql = useCallback(() => {
    try {
      setSqlText(formatAnalyticsSql(sqlText))
      toast.success('SQL formatted')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [sqlText])

  const duplicateSaveName = useMemo(
    () => (savedQ.data ?? []).some((q) => q.name.trim().toLowerCase() === saveName.trim().toLowerCase()),
    [savedQ.data, saveName],
  )

  useEffect(() => {
    if (saveOpen) saveNameRef.current?.focus()
  }, [saveOpen])

  useEffect(() => {
    if (!runMutation.isPending || runStartedAt == null) return
    const id = window.setInterval(() => setRunElapsedMs(Date.now() - runStartedAt), 200)
    return () => window.clearInterval(id)
  }, [runMutation.isPending, runStartedAt])

  const templates = useMemo(() => {
    const view = activeViewName ? quoteIdent(activeViewName) : '<dataset_table>'
    return [
      { label: 'select * (limit 50)', sql: formatAnalyticsSql(`SELECT * FROM ${view} LIMIT 50;`) },
      { label: 'describe view', sql: formatAnalyticsSql(`DESCRIBE ${view};`) },
      { label: 'count rows', sql: formatAnalyticsSql(`SELECT COUNT(*) FROM ${view};`) },
    ]
  }, [activeViewName])

  const otherDatasets = useMemo(
    () => (dq.data ?? []).filter((d) => d.dataset_id !== activeId),
    [dq.data, activeId],
  )

  const toggleDs = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  const runStatusChip = (() => {
    if (runMutation.isPending) {
      return (
        <span className="rounded-full border border-border-accent bg-black/30 px-2 py-0.5 font-mono text-[10px] uppercase text-fg">
          RUNNING — {formatRunDuration(runElapsedMs ?? 0)}
        </span>
      )
    }
    if (runMutation.isSuccess && runFinishedAt != null && runElapsedMs != null && !runMutation.data?.error) {
      return (
        <span className="rounded-full border border-border-default bg-black/20 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
          {formatRunDuration(runElapsedMs)} · {formatCount(runMutation.data.row_count)} rows
        </span>
      )
    }
    return null
  })()

  const activeSchemaExpanded = activeId ? (expanded[activeId] ?? true) : false

  return (
    <PageContainer className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <SqlActiveDatasetChip summary={activeSummary} />

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-black/20 px-2 py-1.5">
            <Button type="button" onClick={() => execRun()} disabled={runMutation.isPending}>
              {hasSelection ? 'Run selection' : 'Run query'}
            </Button>
            <Button type="button" variant="outline" onClick={formatSql}>
              Format
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="gap-1">
                  <History className="h-3.5 w-3.5" />
                  Snippets ▾
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-h-96 w-96 overflow-y-auto p-0" align="start">
                <div className="border-b border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                  Templates
                </div>
                <ul className="p-1">
                  {templates.map((t) => (
                    <li key={t.label}>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                        onClick={() => setSqlText(t.sql)}
                      >
                        {t.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="border-b border-t border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                  Recent
                </div>
                <ul className="p-1">
                  {history.length === 0 ? (
                    <li className="px-2 py-2 text-xs text-fg-muted">No local history yet.</li>
                  ) : (
                    history.map((h, i) => (
                      <li key={i} className="group flex items-start gap-1">
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                          onClick={() => setSqlText(h)}
                        >
                          {h.slice(0, 120)}
                          {h.length > 120 ? '…' : ''}
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-fg-muted opacity-0 hover:bg-white/10 hover:text-fg group-hover:opacity-100"
                          aria-label="Remove from recent"
                          onClick={() => removeHistory(h)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="border-b border-t border-border-default px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                  Saved
                </div>
                <ul className="p-1">
                  {(savedQ.data ?? []).length === 0 ? (
                    <li className="px-2 py-2 text-xs text-fg-muted">None yet — use Save.</li>
                  ) : (
                    (savedQ.data ?? []).map((q) => (
                      <li key={q.saved_id} className="group flex items-start gap-1">
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10"
                          onClick={() => setSqlText(q.sql)}
                        >
                          <span className="font-medium text-fg">{q.name}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-fg-muted">
                            {q.sql.slice(0, 96)}
                            {q.sql.length > 96 ? '…' : ''}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-fg-muted opacity-0 hover:bg-white/10 hover:text-fg group-hover:opacity-100"
                          aria-label={`Delete saved query ${q.name}`}
                          onClick={() => deleteSaved.mutate(q.saved_id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </PopoverContent>
            </Popover>
            <Tooltip content="Save query (⌘S in editor)">
              <Button type="button" variant="secondary" size="icon" aria-label="Save query" onClick={() => setSaveOpen(true)}>
                <Save className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content="Copy SQL">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Copy SQL"
                onClick={() => {
                  void navigator.clipboard.writeText(sqlText)
                  toast.success('SQL copied')
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </Tooltip>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-fg-muted">
                rows
                <Input
                  type="number"
                  value={maxRows}
                  onChange={(e) => setMaxRows(Number(e.target.value) || 0)}
                  className="h-8 w-24"
                  aria-label="max_rows"
                />
              </label>
              {runStatusChip}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <SqlEditor
              ref={sqlEditorHandleRef}
              value={sqlText}
              onChange={setSqlText}
              onRun={execRun}
              onFormat={formatSql}
              onSave={() => setSaveOpen(true)}
              onSelectionChange={setSelectedSql}
              editorRef={cmRef}
              height={sqlEditorHeight}
            />
            <div {...handleProps} aria-label="Resize editor and results" />
            <div className="min-h-0 flex-1 overflow-auto">
              {runMutation.isError ? <QueryErrorBanner message={(runMutation.error as Error).message} /> : null}
              {runMutation.data?.error ? <QueryErrorBanner message={runMutation.data.error} /> : null}
              {runMutation.data && !runMutation.data.error ? (
                <SqlResultsGrid queryResult={runMutation.data} busy={runMutation.isPending} />
              ) : null}
            </div>
          </div>
        </div>

        <div
          className={
            schemaCollapsed
              ? 'relative flex w-9 shrink-0 flex-col items-center border-l border-border-default bg-black/20 py-2'
              : 'relative flex w-[280px] shrink-0 flex-col border-l border-border-default bg-black/20 p-2'
          }
          data-testid="sql-schema-rail"
          data-collapsed={schemaCollapsed ? 'true' : 'false'}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={schemaCollapsed ? 'Expand schema rail' : 'Collapse schema rail'}
            onClick={() => setSchemaCollapsed(!schemaCollapsed)}
          >
            {schemaCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          {schemaCollapsed ? (
            <span
              className="mt-4 select-none text-[10px] font-semibold uppercase tracking-widest text-fg-muted [writing-mode:vertical-rl]"
              aria-hidden
            >
              Schema
            </span>
          ) : (
            <>
              <div className="text-xs font-semibold text-fg-muted">Schema</div>
              <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto text-xs">
                {activeSummary ? (
                  <SchemaDatasetBlock
                    key={activeSummary.dataset_id}
                    summary={activeSummary}
                    expanded={activeSchemaExpanded}
                    onToggle={() => toggleDs(activeSummary.dataset_id)}
                    onInsert={(frag) => insertAtCursor(frag)}
                  />
                ) : (
                  <div className="text-fg-muted">Select a dataset to browse schema.</div>
                )}
                {otherDatasets.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted hover:text-fg"
                      onClick={() => setOtherDatasetsOpen((v) => !v)}
                    >
                      {otherDatasetsOpen ? 'Hide other datasets' : 'Other datasets'}
                    </button>
                    {otherDatasetsOpen
                      ? otherDatasets.map((ds: DatasetSummary) => (
                          <SchemaDatasetBlock
                            key={ds.dataset_id}
                            summary={ds}
                            expanded={!!expanded[ds.dataset_id]}
                            onToggle={() => toggleDs(ds.dataset_id)}
                            onInsert={(frag) => insertAtCursor(frag)}
                          />
                        ))
                      : null}
                  </div>
                ) : null}
                {dq.data?.length === 0 ? <div className="text-fg-muted">No datasets.</div> : null}
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title="Save query" className="max-w-md">
          <div className="space-y-3">
            <div>
              <label htmlFor="dcc-save-q-name" className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                Name
              </label>
              <Input
                id="dcc-save-q-name"
                ref={saveNameRef}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. Monthly revenue check"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="dcc-save-q-desc" className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                Description (optional)
              </label>
              <textarea
                id="dcc-save-q-desc"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="What does this query check?"
                rows={3}
                className="mt-1 w-full rounded-md border border-border-default bg-black/30 px-3 py-2 text-sm text-white placeholder:text-fg-muted focus:border-border-accent focus:outline-none"
              />
            </div>
            {duplicateSaveName && saveName.trim() ? (
              <p className="text-xs text-[hsl(var(--status-warning))]">
                A saved query already exists with this name. Saving will create a duplicate.
              </p>
            ) : null}
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

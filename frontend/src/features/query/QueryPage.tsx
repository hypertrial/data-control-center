import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/ui/section'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { formatAnalyticsSql, quoteIdent } from '@/lib/sql'
import { formatCount } from '@/lib/format'
import { useResizableSplit } from '@/hooks/useResizableSplit'
import { useUiStore } from '@/store/uiStore'
import { QuerySchemaRail } from '@/features/query/QuerySchemaRail'
import { QuerySnippetsMenu } from '@/features/query/QuerySnippetsMenu'
import { SqlActiveDatasetChip } from '@/features/query/SqlActiveDatasetChip'
import { SqlEditor, type SqlEditorHandle } from '@/features/query/SqlEditor'
import { SqlResultsGrid } from '@/features/query/SqlResultsGrid'
import { useDefaultSqlTemplate } from '@/features/query/useDefaultSqlTemplate'
import { formatRunDuration, useQueryRunner } from '@/features/query/useQueryRunner'
import { loadSqlHistory, saveSqlHistory, SQL_HISTORY_CAP } from '@/features/query/useSqlHistory'

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
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [selectedSql, setSelectedSql] = useState('')

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

  const deleteSaved = useMutation({
    mutationFn: (savedId: string) => api.deleteSavedQuery(savedId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-queries'] })
      toast.success('Saved query removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createSaved = useMutation({
    mutationFn: () =>
      api.createSavedQuery({
        name: saveName.trim(),
        sql: sqlText,
        description: saveDescription.trim() || null,
      }),
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

  const getSelectedText = useCallback(() => sqlEditorHandleRef.current?.getSelectedText() ?? '', [])
  const { execRun, runElapsedMs, runFinishedAt, runMutation } = useQueryRunner({
    sqlText,
    selectedSql,
    maxRows,
    getSelectedText,
    pushHistory,
  })

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

  const templates = useMemo(() => {
    const view = activeViewName ? quoteIdent(activeViewName) : '<dataset_table>'
    return [
      { label: 'select * (limit 50)', sql: formatAnalyticsSql(`SELECT * FROM ${view} LIMIT 50;`) },
      { label: 'describe view', sql: formatAnalyticsSql(`DESCRIBE ${view};`) },
      { label: 'count rows', sql: formatAnalyticsSql(`SELECT COUNT(*) FROM ${view};`) },
    ]
  }, [activeViewName])

  const runStatusChip = (() => {
    if (runMutation.isPending) {
      return (
        <span className="rounded-full border border-border-accent bg-black/30 px-2 py-0.5 font-mono text-[10px] uppercase text-fg">
          RUNNING — {formatRunDuration(runElapsedMs ?? 0)}
        </span>
      )
    }
    if (
      runMutation.isSuccess &&
      runFinishedAt != null &&
      runElapsedMs != null &&
      runMutation.data &&
      !runMutation.data.error
    ) {
      return (
        <span className="rounded-full border border-border-default bg-black/20 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
          {formatRunDuration(runElapsedMs)} · {formatCount(runMutation.data.row_count)} rows
        </span>
      )
    }
    return null
  })()

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
            <QuerySnippetsMenu
              templates={templates}
              history={history}
              savedQueries={savedQ.data ?? []}
              onSetSql={setSqlText}
              onRemoveHistory={removeHistory}
              onDeleteSaved={(savedId) => deleteSaved.mutate(savedId)}
            />
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

        <QuerySchemaRail
          activeSummary={activeSummary}
          datasets={dq.data ?? []}
          collapsed={schemaCollapsed}
          onCollapsedChange={setSchemaCollapsed}
          onInsert={insertAtCursor}
        />
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

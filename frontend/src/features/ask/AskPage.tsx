import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { sql } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/ui/section'
import { QueryErrorBanner } from '@/components/ui/query-error-banner'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAskStream } from '@/hooks/useAskStream'
import { useOpenInSql } from '@/hooks/useOpenInSql'
import { useUiStore } from '@/store/uiStore'

function formatCell(v: unknown) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function isNumericCell(typeByCol: Record<string, string>, col: string) {
  const t = (typeByCol[col] || '').toUpperCase()
  return /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|UBIGINT|HUGEINT/i.test(t)
}

export function AskPage() {
  const activeId = useUiStore((s) => s.activeDatasetId)
  const openInSql = useOpenInSql()
  const [question, setQuestion] = useState('')
  const [maxRows, setMaxRows] = useState(200)
  const [scopeMode, setScopeMode] = useState<'active' | 'all'>('active')

  const stream = useAskStream()

  const dataset_ids =
    scopeMode === 'active' && activeId ? [activeId] : null

  const scopeLabel =
    scopeMode === 'active' && activeId
      ? `Active dataset (${activeId})`
      : scopeMode === 'active'
        ? 'Active dataset (none selected — using all)'
        : 'All registered datasets'

  useEffect(() => {
    if (stream.error) toast.error(stream.error)
  }, [stream.error])

  const onRun = () => {
    stream.reset()
    const q = question.trim()
    if (!q) return
    void stream.run({
      question: q,
      dataset_ids,
      max_rows: maxRows || null,
    })
  }

  const onQuestionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (!e.metaKey && !e.ctrlKey) return
    e.preventDefault()
    if (!question.trim() || stream.busy) return
    onRun()
  }

  const typeByCol = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of stream.queryResult?.columns ?? []) m[c.name] = c.type ?? 'unknown'
    return m
  }, [stream.queryResult])

  const displayAnswer = stream.answer || stream.tokenBuffer || ''

  const sqlExtensions = useMemo(
    () => [
      vscodeDark,
      sql(),
      EditorView.editable.of(false),
      EditorView.theme({
        '&': { backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ],
    [],
  )

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1">
              Scope: {scopeLabel}
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              disabled={!activeId}
              onClick={() => setScopeMode('active')}
            >
              Active dataset
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setScopeMode('all')}>All datasets</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span>
          Press{' '}
          <kbd className="rounded border border-border-default px-1 font-mono text-[10px]">⌘</kbd>+
          <kbd className="rounded border border-border-default px-1 font-mono text-[10px]">Enter</kbd>{' '}
          to stream an answer.
        </span>
      </div>

      <div className="space-y-3">
        <label htmlFor="dcc-ask-q" className="sr-only">
          Question
        </label>
        <textarea
          id="dcc-ask-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onQuestionKeyDown}
          placeholder="Ask a question about your data in plain language…"
          rows={5}
          className="w-full resize-y rounded-xl border border-border-default bg-black/30 px-3 py-2 text-sm text-white placeholder:text-fg-muted focus:border-border-accent focus:outline-none"
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[120px]">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
              max_rows
            </div>
            <Input
              type="number"
              value={maxRows}
              onChange={(e) => setMaxRows(Number(e.target.value) || 0)}
            />
          </div>
          <Button
            type="button"
            className="gap-1"
            disabled={stream.busy || !question.trim()}
            onClick={() => onRun()}
          >
            <Sparkles className="h-4 w-4" />
            {stream.busy ? 'Streaming…' : 'Ask (stream)'}
          </Button>
          {stream.busy ? (
            <Button type="button" variant="outline" onClick={() => stream.cancel()}>
              Stop
            </Button>
          ) : null}
        </div>
      </div>

      {displayAnswer ? (
        <div className="rounded-xl border border-border-default bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Answer</div>
          <div className="prose prose-invert prose-sm mt-2 max-w-none [&_p]:my-2 [&_ul]:my-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayAnswer}</ReactMarkdown>
          </div>
        </div>
      ) : null}

      {(stream.explanation || stream.sql) && (
        <div className="space-y-2 rounded-xl border border-border-default bg-black/20 p-4">
          {stream.explanation ? (
            <div>
              <div className="text-xs font-semibold text-fg-muted">Model note</div>
              <p className="mt-1 text-sm text-white/90">{stream.explanation}</p>
            </div>
          ) : null}
          {stream.sql ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-fg-muted">Generated SQL</span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openInSql(stream.sql!)}>
                    Open in SQL
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(stream.sql!)
                      toast.success('SQL copied')
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-border-default">
                <CodeMirror
                  value={stream.sql}
                  height="120px"
                  theme="none"
                  extensions={sqlExtensions}
                  editable={false}
                  className="text-xs [&_.cm-editor]:rounded-lg"
                  basicSetup={{ lineNumbers: true, foldGutter: false }}
                />
              </div>
            </div>
          ) : null}
          {stream.model ? (
            <p className="text-[10px] text-fg-muted">Model: {stream.model}</p>
          ) : null}
        </div>
      )}

      {stream.queryResult &&
        !stream.queryResult.error &&
        stream.queryResult.columns.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-fg-muted">
              <span className="tabular-nums">{stream.queryResult.row_count}</span> rows
              {stream.queryResult.truncated ? ' (truncated)' : ''}
            </div>
            <Table>
              <caption className="sr-only">Agent query result</caption>
              <THead>
                <TR>
                  {stream.queryResult.columns.map((c) => (
                    <TH key={c.name} scope="col">
                      {c.name}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {stream.queryResult.rows.map((row, i) => (
                  <TR key={i}>
                    {stream.queryResult!.columns.map((c) => (
                      <TD
                        key={c.name}
                        className={
                          isNumericCell(typeByCol, c.name)
                            ? 'max-w-[200px] truncate font-mono text-xs'
                            : 'max-w-[200px] truncate text-xs'
                        }
                      >
                        {formatCell(row[c.name])}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}

      {stream.error ? <QueryErrorBanner message={stream.error} /> : null}

      {stream.queryResult?.error && <QueryErrorBanner message={stream.queryResult.error} />}
    </PageContainer>
  )
}
